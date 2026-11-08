/**
 * T4 / DEC-148: script de leitura do funil booking_session (sem transcript).
 * Só agregação local + dry-run; não toca DO/D1 remotos.
 */
import { DatabaseSync } from 'node:sqlite'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — script .mjs sem tipos
import { aggregateBookingSessionFunnel, bookingSessionFunnelPlan, buildBookingSessionFunnelSql, formatFunnelReport, parseTelemetryLine, parseTelemetryLines } from '../../scripts/booking-session-funnel.mjs'

const root = resolve(__dirname, '../..')

describe('scripts/booking-session-funnel.mjs', () => {
  it('exige ambiente e tenant válidos', () => {
    expect(bookingSessionFunnelPlan([])).toBeNull()
    expect(bookingSessionFunnelPlan(['staging'])).toBeNull()
    expect(bookingSessionFunnelPlan(['staging', "x' OR 1=1 --"])).toBeNull()
    expect(bookingSessionFunnelPlan(['staging', 'clinic-a', '06/11/2026'])).toBeNull()
    expect(bookingSessionFunnelPlan(['staging', 'clinic-a', '2026-11-06'])).toMatchObject({
      env: 'staging',
      tenantId: 'clinic-a',
      since: '2026-11-06',
      fromJsonl: null,
    })
    expect(
      bookingSessionFunnelPlan(['staging', 'clinic-a', '--from-jsonl', './x.jsonl']),
    ).toMatchObject({ fromJsonl: './x.jsonl', tenantId: 'clinic-a' })
  })

  it('sem --from-jsonl imprime pacote SQL + filtros (sem remoto)', () => {
    const r = spawnSync(
      'node',
      [resolve(root, 'scripts/booking-session-funnel.mjs'), 'staging', 'clinic-a', '2026-11-06'],
      { cwd: root, encoding: 'utf8', env: { ...process.env } },
    )
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('FROM booking_sessions')
    expect(r.stdout).toContain('ai.turn_decided')
    expect(r.stdout).toContain('Sem UI de transcript')
    expect(r.stdout).not.toMatch(/mensagem da cliente|transcript completo/i)
  })

  it('SQL de outcomes / friction rejeita tenant inválido e corre em SQLite', () => {
    expect(() => buildBookingSessionFunnelSql("x'; DROP TABLE t; --", 0)).toThrow(/inválido/)
    const sql = buildBookingSessionFunnelSql('clinic-a', 1000) as {
      outcomes: string
      dropSteps: string
      maxSteps: string
      flowUsed: string
      frictionTop: string
    }
    const db = new DatabaseSync(':memory:')
    try {
      db.exec(`
        CREATE TABLE booking_sessions (
          session_id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          conversation_id TEXT NOT NULL,
          opened_at INTEGER NOT NULL,
          closed_at INTEGER,
          outcome TEXT,
          drop_step TEXT,
          max_step TEXT,
          inbound_turns INTEGER NOT NULL DEFAULT 0,
          flow_used INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE outbox_events (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          occurred_at INTEGER NOT NULL
        );
      `)
      db.prepare(
        `INSERT INTO booking_sessions
         (session_id, tenant_id, conversation_id, opened_at, closed_at, outcome, drop_step, max_step, flow_used)
         VALUES (?, 'clinic-a', 'c1', 2000, 3000, ?, ?, ?, ?)`,
      ).run('bss_1', 'agendado', null, 'confirm', 1)
      db.prepare(
        `INSERT INTO booking_sessions
         (session_id, tenant_id, conversation_id, opened_at, closed_at, outcome, drop_step, max_step, flow_used)
         VALUES (?, 'clinic-a', 'c2', 2000, 3000, ?, ?, ?, ?)`,
      ).run('bss_2', 'abandon', 'variant_ask', 'variant_ask', 0)
      db.prepare(
        `INSERT INTO booking_sessions
         (session_id, tenant_id, conversation_id, opened_at, closed_at, outcome, drop_step, max_step, flow_used)
         VALUES (?, 'other', 'c3', 2000, 3000, 'handoff', 'hub', 'hub', 0)`,
      ).run('bss_x')
      db.prepare(
        `INSERT INTO outbox_events (id, tenant_id, type, payload_json, occurred_at)
         VALUES ('o1', 'clinic-a', 'ai.turn_decided', ?, 2500)`,
      ).run(
        JSON.stringify({
          sessionId: 'bss_2',
          friction: [{ flag: 'nao_encontrei' }, { flag: 'particle_as_zone' }],
        }),
      )
      db.prepare(
        `INSERT INTO outbox_events (id, tenant_id, type, payload_json, occurred_at)
         VALUES ('o2', 'clinic-a', 'ai.turn_decided', ?, 2500)`,
      ).run(JSON.stringify({ sessionId: 'bss_2', friction: [{ flag: 'nao_encontrei' }] }))

      const outcomes = db.prepare(sql.outcomes).all() as { outcome: string; n: number }[]
      expect(outcomes).toEqual(
        expect.arrayContaining([
          { outcome: 'agendado', n: 1 },
          { outcome: 'abandon', n: 1 },
        ]),
      )
      const drops = db.prepare(sql.dropSteps).all() as { step: string; n: number }[]
      expect(drops).toEqual([{ step: 'variant_ask', n: 1 }])
      const flow = db.prepare(sql.flowUsed).get() as {
        fechadas: number
        com_flow: number
        agendadas: number
      }
      expect(flow).toEqual({ fechadas: 2, com_flow: 1, agendadas: 1 })
      const fr = db.prepare(sql.frictionTop).all() as { flag: string; n: number }[]
      expect(fr).toEqual(
        expect.arrayContaining([
          { flag: 'nao_encontrei', n: 2 },
          { flag: 'particle_as_zone', n: 1 },
        ]),
      )
    } finally {
      db.close()
    }
  })

  it('parseia JSONL e agrega outcomes / funil / friction sem texto', () => {
    expect(parseTelemetryLine('')).toBeNull()
    expect(parseTelemetryLine('{"level":"info","event":"noise"}')).toBeNull()

    const lines = [
      JSON.stringify({
        level: 'info',
        event: 'booking_session.opened',
        sessionId: 'bss_1',
        tenantId: 'clinic-a',
        occurredAt: 2000,
      }),
      JSON.stringify({
        level: 'info',
        event: 'ai.turn_decided',
        sessionId: 'bss_1',
        tenantId: 'clinic-a',
        occurredAt: 2100,
        step: 'variant_ask',
        friction: [{ flag: 'nao_encontrei', kind: 'zone', termHash: 'abc' }],
      }),
      JSON.stringify({
        level: 'info',
        event: 'booking_session.ended',
        sessionId: 'bss_1',
        tenantId: 'clinic-a',
        occurredAt: 2200,
        outcome: 'abandon',
        dropStep: 'variant_ask',
        flowUsed: false,
      }),
      JSON.stringify({
        level: 'info',
        event: 'booking_session.opened',
        sessionId: 'bss_2',
        tenantId: 'clinic-a',
        occurredAt: 2300,
      }),
      JSON.stringify({
        level: 'info',
        event: 'booking_session.flow',
        sessionId: 'bss_2',
        tenantId: 'clinic-a',
        occurredAt: 2350,
        flowState: 'completed',
      }),
      JSON.stringify({
        level: 'info',
        event: 'ai.turn_decided',
        sessionId: 'bss_2',
        tenantId: 'clinic-a',
        occurredAt: 2400,
        step: 'confirm',
        friction: [],
      }),
      JSON.stringify({
        level: 'info',
        event: 'booking_session.ended',
        sessionId: 'bss_2',
        tenantId: 'clinic-a',
        occurredAt: 2500,
        outcome: 'agendado',
        dropStep: null,
        flowUsed: true,
      }),
      // outro tenant — ignorado
      JSON.stringify({
        level: 'info',
        event: 'booking_session.ended',
        sessionId: 'bss_x',
        tenantId: 'other',
        occurredAt: 2600,
        outcome: 'handoff',
        dropStep: 'hub',
      }),
    ]
    const events = parseTelemetryLines(lines)
    expect(events).toHaveLength(8)
    const report = aggregateBookingSessionFunnel(events, { tenantId: 'clinic-a', sinceMs: 0 })
    expect(report.sessionsSeen).toBe(2)
    expect(report.closed).toBe(2)
    expect(report.outcomes).toEqual([
      { key: 'abandon', n: 1 },
      { key: 'agendado', n: 1 },
    ])
    expect(report.dropSteps).toEqual([{ key: 'variant_ask', n: 1 }])
    expect(report.topFriction).toEqual([{ key: 'nao_encontrei', n: 1 }])
    expect(report.flowUsedAmongClosed).toEqual({ closed: 2, withFlow: 1 })
    const variant = report.funnelReached.find((r: { step: string; n: number }) => r.step === 'variant_ask')
    const confirm = report.funnelReached.find((r: { step: string; n: number }) => r.step === 'confirm')
    expect(variant?.n).toBe(2) // ambas passaram pelo menos variant (bss_1) / confirm (bss_2 inclui)
    expect(confirm?.n).toBe(1)
    const text = formatFunnelReport(report)
    expect(text).toContain('nao_encontrei: 1')
    expect(text).toContain('Sem lista de mensagens')
    expect(text).not.toMatch(/Quero agendar|mensagem da cliente/i)
  })

  it('--from-jsonl agrega a partir de ficheiro', () => {
    const jsonl = [
      JSON.stringify({
        event: 'booking_session.ended',
        sessionId: 'bss_1',
        tenantId: 'clinic-a',
        occurredAt: 1_700_000_000_000,
        outcome: 'handoff',
        dropStep: 'echo',
        flowUsed: false,
      }),
    ].join('\n')
    const r = spawnSync(
      'node',
      [
        resolve(root, 'scripts/booking-session-funnel.mjs'),
        'staging',
        'clinic-a',
        '2023-01-01',
        '--from-jsonl',
        '-',
      ],
      {
        cwd: root,
        encoding: 'utf8',
        input: jsonl,
        env: { ...process.env, TREDANE_FUNNEL_DRY_RUN: '' },
      },
    )
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('handoff: 1')
    expect(r.stdout).toContain('echo: 1')
  })
})
