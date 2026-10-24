import { describe, expect, it } from 'vitest'
import {
  OPS_ALERT_KINDS,
  PROPOSED_ALERT_THRESHOLDS,
  PROPOSED_OPS_BUDGETS,
  RECOVERY_POLICY,
  SECRETS_INVENTORY,
  assertIsolationPreserved,
  assertLogLineSafe,
  assessSchemaCompatibility,
  buildRecoveryRehearsalReport,
  buildSyntheticLoadReport,
  createChannelLogger,
  emitOpsAlert,
  evaluateOpsSignals,
  formatOpsLogLine,
  isForbiddenLogKey,
  listRequiredSecretsFor,
  newCorrelationId,
  scrubLogDetail,
  summarizeLatency,
} from './index'
import { ADMIN_SCHEMA_VERSION } from '../db/admin/constants'
import { CLINIC_SCHEMA_VERSION } from '../clinic/constants'

describe('ops log / AC-15', () => {
  it('remove chaves pessoais e redige segredos', () => {
    const scrubbed = scrubLogDetail({
      tenantId: 'clinic-demo-a',
      stage: 'enqueue',
      body: 'Olá Maria, quero agendar',
      waId: '5511999999999',
      token: 'sk_test_abc',
      authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaaa.bbbb',
      receiptId: 'rcpt_1',
    })
    expect(scrubbed).toEqual({
      tenantId: 'clinic-demo-a',
      stage: 'enqueue',
      receiptId: 'rcpt_1',
    })
    expect(isForbiddenLogKey('displayName')).toBe(true)
    expect(isForbiddenLogKey('receiptId')).toBe(false)
  })

  it('linha formatada é JSON seguro e correlacionável', () => {
    const line = formatOpsLogLine({
      level: 'error',
      channel: 'inbound_queue',
      event: 'queue.poison',
      correlationId: 'corr_test',
      tenantId: 'clinic-demo-a',
      operation: 'whatsapp.ingest',
      stage: 'consume',
      outcome: 'failed',
      detail: {
        receiptId: 'rcpt_x',
        body: 'não deve aparecer',
        phone: '5511888888888',
      },
    })
    const check = assertLogLineSafe(line)
    expect(check.ok).toBe(true)
    const parsed = JSON.parse(line) as Record<string, unknown>
    expect(parsed.correlationId).toBe('corr_test')
    expect(parsed.tenantId).toBe('clinic-demo-a')
    expect(parsed.event).toBe('queue.poison')
    expect(parsed.body).toBeUndefined()
    expect(parsed.phone).toBeUndefined()
    expect(parsed.receiptId).toBe('rcpt_x')
  })

  it('channel logger escreve no sink', () => {
    const lines: string[] = []
    const log = createChannelLogger(
      'test_channel',
      { tenantId: 'clinic-demo-a' },
      (line) => lines.push(line),
    )
    log({
      level: 'warn',
      event: 'test.event',
      detail: { stage: 'x', email: 'a@b.c' },
    })
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>
    expect(parsed.channel).toBe('test_channel')
    expect(parsed.email).toBeUndefined()
    expect(parsed.tenantId).toBe('clinic-demo-a')
  })

  it('newCorrelationId é estável no prefixo', () => {
    expect(newCorrelationId('ops')).toMatch(/^ops_[a-f0-9]{16}$/)
  })
})

describe('ops alerts', () => {
  it('avalia sinais com limiares Propostos', () => {
    const alerts = evaluateOpsSignals({
      dlqDepth: 2,
      staleOutboxCount: PROPOSED_ALERT_THRESHOLDS.staleOutboxCount,
      uncertainOutboundCount: 0,
      schemaMismatch: true,
    })
    const kinds = alerts.map((a) => a.kind)
    expect(kinds).toContain('dlq.depth')
    expect(kinds).toContain('outbox.stale')
    expect(kinds).toContain('schema.mismatch')
    expect(OPS_ALERT_KINDS.length).toBeGreaterThan(5)
  })

  it('emite alerta sem PII', () => {
    const lines: string[] = []
    const result = emitOpsAlert(
      {
        kind: 'meta.failure',
        tenantId: 'clinic-demo-a',
        fields: { attempts: 3, body: 'segredo' },
      },
      (line) => lines.push(line),
    )
    expect(result.severity).toBe('critical')
    expect(assertLogLineSafe(lines[0]!).ok).toBe(true)
    expect(lines[0]).not.toContain('segredo')
  })
})

describe('ops budgets / load', () => {
  it('resume latência contra budget Proposto', () => {
    const summary = summarizeLatency({
      name: 'do.ping',
      durationsMs: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
    })
    expect(summary.p50Ms).toBeGreaterThan(0)
    expect(summary.proposedP95Ms).toBe(150)
    expect(summary.withinProposedP95).toBe(true)
    expect(PROPOSED_OPS_BUDGETS.some((b) => b.status === 'proposto')).toBe(true)
  })

  it('buildSyntheticLoadReport agrega clínicas', () => {
    const report = buildSyntheticLoadReport({
      samples: [
        summarizeLatency({ name: 'do.ping', durationsMs: [5, 5, 5] }),
      ],
      clinicSnapshots: [
        {
          tenantId: 'clinic-demo-a',
          schemaVersion: CLINIC_SCHEMA_VERSION,
          schemaReady: true,
          pendingOutbox: 0,
          failedOutbox: 0,
          uncertainOutbound: 0,
          contactCount: 1,
          messageCount: 2,
          appointmentCount: 0,
          attachmentMetaCount: 0,
        },
      ],
    })
    expect(report.withinProposedBudgets).toBe(true)
    expect(report.clinicSnapshots).toHaveLength(1)
  })
})

describe('ops recovery', () => {
  it('schema compat usa versões actuais', () => {
    const ok = assessSchemaCompatibility({
      adminActual: ADMIN_SCHEMA_VERSION,
      clinicActual: CLINIC_SCHEMA_VERSION,
      r2PrefixOk: true,
    })
    expect(ok.compatible).toBe(true)
    const bad = assessSchemaCompatibility({
      adminActual: 1,
      clinicActual: CLINIC_SCHEMA_VERSION,
      r2PrefixOk: true,
    })
    expect(bad.compatible).toBe(false)
  })

  it('isolamento A/B e política anti-reenvio', () => {
    expect(assertIsolationPreserved({ contacts: 2 }, { contacts: 2 }).ok).toBe(
      true,
    )
    expect(
      assertIsolationPreserved({ contacts: 2 }, { contacts: 3 }).ok,
    ).toBe(false)
    const report = buildRecoveryRehearsalReport({
      tenantA: 'clinic-demo-a',
      tenantB: 'clinic-demo-b',
      adminSchemaVersion: ADMIN_SCHEMA_VERSION,
      clinicSchemaVersionA: CLINIC_SCHEMA_VERSION,
      r2PrefixOk: true,
      tenantBBefore: { contacts: 1, messages: 2 },
      tenantBAfter: { contacts: 1, messages: 2 },
      emitAlertOnBreach: false,
    })
    expect(report.isolationOk).toBe(true)
    expect(report.guarantees).toContain('sem_reenvio_whatsapp_automatico')
    expect(report.openGates.some((g) => g.includes('PITR'))).toBe(true)
    expect(RECOVERY_POLICY.neverResendWhatsapp).toBe(true)
  })
})

describe('ops secrets inventory', () => {
  it('lista secrets obrigatórios de staging sem valores', () => {
    const required = listRequiredSecretsFor('staging')
    expect(required.some((s) => s.name === 'CLERK_SECRET_KEY')).toBe(true)
    expect(SECRETS_INVENTORY.every((s) => !('value' in s))).toBe(true)
  })
})
