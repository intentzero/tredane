/**
 * T5 / DEC-148: ritual semanal — amostra + backlog só-lista (sem auto-apply).
 */
import { DatabaseSync } from 'node:sqlite'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — script .mjs sem tipos
import { buildWeeklySampleSql, formatWeeklySampleMarkdown, sampleWeeklySessions, suggestLexiconKind, weeklySamplePlan } from '../../scripts/booking-session-weekly-sample.mjs'
// @ts-expect-error — script .mjs sem tipos
import { parseTelemetryLines } from '../../scripts/booking-session-funnel.mjs'

const root = resolve(__dirname, '../..')

describe('scripts/booking-session-weekly-sample.mjs', () => {
  it('exige ambiente, tenant e --n válidos', () => {
    expect(weeklySamplePlan([])).toBeNull()
    expect(weeklySamplePlan(['staging'])).toBeNull()
    expect(weeklySamplePlan(['staging', "x' OR 1=1 --"])).toBeNull()
    expect(weeklySamplePlan(['staging', 'clinic-a', '06/11/2026'])).toBeNull()
    expect(weeklySamplePlan(['staging', 'clinic-a', '--n', '0'])).toBeNull()
    expect(weeklySamplePlan(['staging', 'clinic-a', '--n', '99'])).toBeNull()
    expect(weeklySamplePlan(['staging', 'clinic-a', '2026-11-06', '--n', '5'])).toMatchObject({
      env: 'staging',
      tenantId: 'clinic-a',
      since: '2026-11-06',
      n: 5,
      fromJsonl: null,
    })
    expect(
      weeklySamplePlan(['staging', 'clinic-a', '--from-jsonl', './x.jsonl', '--n', '3']),
    ).toMatchObject({ fromJsonl: './x.jsonl', n: 3 })
  })

  it('sem --from-jsonl imprime pacote SQL + checklist (sem remoto)', () => {
    const r = spawnSync(
      'node',
      [resolve(root, 'scripts/booking-session-weekly-sample.mjs'), 'staging', 'clinic-a', '2026-11-06', '--n', '8'],
      { cwd: root, encoding: 'utf8', env: { ...process.env } },
    )
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('FROM booking_sessions')
    expect(r.stdout).toContain('unmatched_terms')
    expect(r.stdout).toContain('Sem auto-apply')
    expect(r.stdout).toContain('booking-session-funnel.mjs')
    expect(r.stdout).not.toMatch(/mensagem da cliente|transcript completo/i)
  })

  it('SQL amostra rejeita tenant inválido e corre em SQLite', () => {
    expect(() => buildWeeklySampleSql("x'; DROP TABLE t; --", 0, 10)).toThrow(/inválido/)
    const sql = buildWeeklySampleSql('clinic-a', 1000, 5) as {
      abandonHandoff: string
      withFriction: string
      unmatchedOpen: string
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
        CREATE TABLE unmatched_terms (
          tenant_id TEXT NOT NULL,
          id TEXT NOT NULL,
          term TEXT NOT NULL,
          term_folded TEXT NOT NULL,
          hits INTEGER NOT NULL,
          status TEXT NOT NULL,
          first_seen_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          PRIMARY KEY (tenant_id, id)
        );
      `)
      db.prepare(
        `INSERT INTO booking_sessions
         (session_id, tenant_id, conversation_id, opened_at, closed_at, outcome, drop_step)
         VALUES ('bss_1', 'clinic-a', 'c1', 2000, 3000, 'abandon', 'variant_ask')`,
      ).run()
      db.prepare(
        `INSERT INTO booking_sessions
         (session_id, tenant_id, conversation_id, opened_at, closed_at, outcome, drop_step)
         VALUES ('bss_ok', 'clinic-a', 'c2', 2000, 3000, 'agendado', NULL)`,
      ).run()
      db.prepare(
        `INSERT INTO outbox_events (id, tenant_id, type, payload_json, occurred_at)
         VALUES ('o1', 'clinic-a', 'ai.turn_decided', ?, 2500)`,
      ).run(
        JSON.stringify({
          sessionId: 'bss_1',
          friction: [{ flag: 'particle_as_zone', termHash: 'deadbeef' }],
        }),
      )
      db.prepare(
        `INSERT INTO unmatched_terms
         (tenant_id, id, term, term_folded, hits, status, first_seen_at, last_seen_at)
         VALUES ('clinic-a', 'umt_1', 'depilar', 'depilar', 3, 'aberto', 1, 2)`,
      ).run()

      const abandons = db.prepare(sql.abandonHandoff).all() as { session_id: string; outcome: string }[]
      expect(abandons).toHaveLength(1)
      expect(abandons[0]).toMatchObject({
        session_id: 'bss_1',
        outcome: 'abandon',
        conversation_id: 'c1',
        drop_step: 'variant_ask',
      })
      const fr = db.prepare(sql.withFriction).all() as { session_id: string; flag: string; term_hash: string }[]
      expect(fr[0]).toMatchObject({ session_id: 'bss_1', flag: 'particle_as_zone', term_hash: 'deadbeef' })
      const um = db.prepare(sql.unmatchedOpen).all() as { term: string; hits: number }[]
      expect(um).toHaveLength(1)
      expect(um[0]).toMatchObject({ id: 'umt_1', term: 'depilar', hits: 3, status: 'aberto' })
    } finally {
      db.close()
    }
  })

  it('suggestLexiconKind separa stop_word de synonym sem auto', () => {
    expect(suggestLexiconKind({ flag: 'particle_as_zone', termHash: 'a' })).toBe('stop_word')
    expect(suggestLexiconKind({ flag: 'nao_encontrei', kind: 'particle_suspected' })).toBe('stop_word')
    expect(suggestLexiconKind({ flag: 'nao_encontrei', kind: 'catalog', termHash: 'b' })).toBe('synonym')
    expect(suggestLexiconKind({ flag: 'nao_encontrei', kind: 'zone' })).toBeNull()
    expect(suggestLexiconKind({ flag: 'mode_uma_todas' })).toBeNull()
  })

  it('amostra prioriza friction/abandon e monta backlog só-lista', () => {
    const lines = [
      JSON.stringify({
        event: 'booking_session.ended',
        sessionId: 'bss_ok',
        tenantId: 'clinic-a',
        conversationId: 'c0',
        occurredAt: 1000,
        outcome: 'agendado',
      }),
      JSON.stringify({
        event: 'ai.turn_decided',
        sessionId: 'bss_fr',
        tenantId: 'clinic-a',
        conversationId: 'c1',
        occurredAt: 2000,
        friction: [
          { flag: 'particle_as_zone', termHash: 'abc123' },
          { flag: 'nao_encontrei', kind: 'catalog', termHash: 'def456' },
        ],
      }),
      JSON.stringify({
        event: 'booking_session.ended',
        sessionId: 'bss_fr',
        tenantId: 'clinic-a',
        conversationId: 'c1',
        occurredAt: 2100,
        outcome: 'abandon',
        dropStep: 'variant_ask',
      }),
      JSON.stringify({
        event: 'booking_session.ended',
        sessionId: 'bss_h',
        tenantId: 'clinic-a',
        conversationId: 'c2',
        occurredAt: 2200,
        outcome: 'handoff',
        dropStep: 'echo',
      }),
      JSON.stringify({
        event: 'booking_session.ended',
        sessionId: 'bss_x',
        tenantId: 'other',
        occurredAt: 2300,
        outcome: 'abandon',
      }),
    ]
    const events = parseTelemetryLines(lines)
    const sheet = sampleWeeklySessions(events, { tenantId: 'clinic-a', sinceMs: 0, n: 2 })
    expect(sheet.autoApply).toBe(false)
    expect(sheet.eligibleCount).toBe(2) // bss_fr + bss_h (agendado sem friction fora)
    expect(sheet.sample).toHaveLength(2)
    expect(sheet.sample[0].sessionId).toBe('bss_fr')
    expect(sheet.sample[0].friction.map((f: { flag: string }) => f.flag)).toEqual(
      expect.arrayContaining(['particle_as_zone', 'nao_encontrei']),
    )
    expect(sheet.backlog.map((b: { suggest: string }) => b.suggest).sort()).toEqual([
      'stop_word',
      'synonym',
    ])
    const md = formatWeeklySampleMarkdown(sheet, null)
    expect(md).toContain('auto-apply: false')
    expect(md).toContain('stop_word')
    expect(md).toContain('synonym')
    expect(md).toContain('abc123')
    expect(md).not.toMatch(/Quero agendar|mensagem da cliente/i)
  })

  it('--from-jsonl gera ficha Markdown', () => {
    const jsonl = [
      JSON.stringify({
        event: 'ai.turn_decided',
        sessionId: 'bss_1',
        tenantId: 'clinic-a',
        occurredAt: 1_700_000_000_100,
        friction: [{ flag: 'nao_encontrei', kind: 'particle_suspected', termHash: 'feedface' }],
      }),
      JSON.stringify({
        event: 'booking_session.ended',
        sessionId: 'bss_1',
        tenantId: 'clinic-a',
        occurredAt: 1_700_000_000_200,
        outcome: 'abandon',
        dropStep: 'day_ask',
      }),
    ].join('\n')
    const r = spawnSync(
      'node',
      [
        resolve(root, 'scripts/booking-session-weekly-sample.mjs'),
        'staging',
        'clinic-a',
        '2023-01-01',
        '--n',
        '5',
        '--from-jsonl',
        '-',
      ],
      {
        cwd: root,
        encoding: 'utf8',
        input: jsonl,
        env: { ...process.env, TREDANE_WEEKLY_DRY_RUN: '' },
      },
    )
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('bss_1')
    expect(r.stdout).toContain('stop_word')
    expect(r.stdout).toContain('feedface')
    expect(r.stdout).toContain('auto-apply: false')
  })
})
