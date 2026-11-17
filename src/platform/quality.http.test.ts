import { describe, expect, it } from 'vitest'
import { createApp } from '../worker/app'
import { bootAdminDb } from '../db/test-db'
import { asyncFromSync } from '../db/admin/async-store'
import {
  createSyntheticAuthorityReader,
  createSyntheticSessionAuthenticator,
  synthAuthHeader,
  type AuthServices,
} from '../auth'
import { createControllableClock } from '../db/clock'
import { listAuditForTenant } from '../db/admin'
import { upsertConversationQualityEpisode } from '../conversation-metrics/store'
import { fetchConversationMetricsReport } from '../conversation-metrics/query'
import type { ConversationQualityEpisodeRow } from '../conversation-metrics/types'
import { upsertReviewSampleSync, REVIEW_SAMPLE_TTL_MS } from '../review-samples'
import type { ReviewSampleSnapshot } from '../review-samples'
import { maskPhone } from './quality'

const SUPER = 'user_synth_superadmin'
const NOW = 3_100_000_000_000
const HOUR = 3_600_000

function testApp() {
  const boot = bootAdminDb()
  const clock = createControllableClock(NOW)
  const services: AuthServices = {
    sessions: createSyntheticSessionAuthenticator({ authorizedParties: ['http://localhost:5173'] }),
    authority: createSyntheticAuthorityReader(),
    adminDb: asyncFromSync(boot.db),
  }
  const app = createApp({ authServicesFactory: () => services, syncAdminDbFactory: () => boot.db, clockFactory: () => clock })
  const call = (user: string, path: string) =>
    app.request(`http://localhost${path}`, { headers: { Authorization: synthAuthHeader(user) } })
  return { boot, clock, call, db: asyncFromSync(boot.db), close: boot.close }
}

const episode = (over: Partial<ConversationQualityEpisodeRow> & Pick<ConversationQualityEpisodeRow, 'sessionId'>): ConversationQualityEpisodeRow => ({
  tenantId: 'clinic-demo-a',
  conversationId: `cnv_${over.sessionId}`,
  openedAt: NOW - 2 * HOUR,
  closedAt: NOW - HOUR,
  lastMessageAt: NOW - HOUR,
  outcome: 'agendado',
  dropStep: null,
  maxStep: null,
  inboundTurns: 4,
  inboundTurnsToConfirm: 4,
  confirmedAppointmentId: 'apt_1',
  bookingIntent: true,
  misunderstandingTurns: 0,
  attendantSpontaneous: 0,
  attendantOfferedRule: 0,
  attendantRecognized: 0,
  attendantRegistered: 0,
  attendantLastStep: null,
  handoffUnattended: false,
  falseConfirmation: false,
  aiAppointmentFulfillment: null,
  expiresAt: NOW + 90 * 24 * HOUR,
  ...over,
})

const sample = (over: Partial<ReviewSampleSnapshot> = {}): ReviewSampleSnapshot => ({
  tenantId: 'clinic-demo-a',
  tenantName: 'Clínica Demo',
  conversationId: 'cnv_a1',
  contactId: 'ct_1',
  contactWaId: '5511999990001',
  contactDisplayName: 'Ana Exemplo',
  flagSource: 'client',
  flagReason: 'nao_encontrei',
  clientComment: 'o sistema travou',
  clientComments: ['o sistema travou'],
  flaggedAt: NOW - HOUR,
  lastMessageAt: NOW - HOUR + 100,
  lastMessagePreview: 'Não encontrei cotovelo',
  messages: [
    { messageId: 'm1', direction: 'inbound', body: 'quero cotovelo', createdAt: NOW - HOUR, deliveryState: 'delivered', authorClerkUserId: null, authorDisplayName: null },
    { messageId: 'm2', direction: 'outbound', body: 'Não encontrei cotovelo nas opções.', createdAt: NOW - HOUR + 100, deliveryState: 'sent', authorClerkUserId: null, authorDisplayName: null },
  ],
  ...over,
})

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as Json

describe('HTTP — qualidade da IA na Platform Admin (#834, AC-86)', () => {
  it('métricas: coincidem com as do Review MCP (mesma função) e respeitam o filtro de clínica', async () => {
    const ctx = testApp()
    try {
      await upsertConversationQualityEpisode(ctx.db, episode({ sessionId: 's1' }))
      await upsertConversationQualityEpisode(ctx.db, episode({ sessionId: 's2', outcome: 'abandon', confirmedAppointmentId: null, inboundTurnsToConfirm: null }))
      await upsertConversationQualityEpisode(ctx.db, episode({ sessionId: 's3', tenantId: 'clinic-demo-b' }))
      const res = await ctx.call(SUPER, '/api/platform/quality/metrics?sinceHours=168')
      expect(res.status).toBe(200)
      const body = await json(res)
      expect(body.metrics.bookingRate).toMatchObject({ episodesWithIntent: 3, confirmed: 2 })
      const direct = await fetchConversationMetricsReport(ctx.db, { tenantId: null, fromMs: NOW - 168 * HOUR, toMs: NOW }, NOW)
      expect(body.metrics).toEqual(JSON.parse(JSON.stringify(direct)))
      const onlyA = await json(await ctx.call(SUPER, '/api/platform/quality/metrics?tenantId=clinic-demo-a'))
      expect(onlyA.metrics.bookingRate).toMatchObject({ episodesWithIntent: 2, confirmed: 1 })
      expect(JSON.stringify(body)).not.toMatch(/mensagem|message_body|phone/i)
    } finally {
      ctx.close()
    }
  })

  it('métricas: janela inválida dá 400', async () => {
    const ctx = testApp()
    try {
      for (const q of ['sinceHours=0', 'sinceHours=abc', 'sinceHours=99999']) {
        expect((await ctx.call(SUPER, `/api/platform/quality/metrics?${q}`)).status, q).toBe(400)
      }
    } finally {
      ctx.close()
    }
  })

  it('amostras: lista com telefone mascarado e comentários da cliente; filtro por clínica; sem o número', async () => {
    const ctx = testApp()
    try {
      upsertReviewSampleSync(ctx.boot.db, sample(), NOW)
      upsertReviewSampleSync(ctx.boot.db, sample({ tenantId: 'clinic-demo-b', tenantName: 'B', conversationId: 'cnv_b1', contactWaId: '5521988880002' }), NOW)
      const res = await ctx.call(SUPER, '/api/platform/quality/samples')
      expect(res.status).toBe(200)
      const body = await json(res)
      expect(body.samples).toHaveLength(2)
      const a = body.samples.find((s: Json) => s.tenantId === 'clinic-demo-a')
      expect(a).toMatchObject({ contactPhoneMasked: '••••0001', contactDisplayName: 'Ana Exemplo', flagSource: 'client', clientComments: ['o sistema travou'], messageCount: 2 })
      expect(JSON.stringify(body)).not.toMatch(/5511999990001|5521988880002|contactWaId/)
      const only = await json(await ctx.call(SUPER, '/api/platform/quality/samples?tenantId=clinic-demo-b'))
      expect(only.samples.map((s: Json) => s.tenantId)).toEqual(['clinic-demo-b'])
      expect((await ctx.call(SUPER, '/api/platform/quality/samples?before=abc')).status).toBe(400)
    } finally {
      ctx.close()
    }
  })

  it('amostra: mostra o texto das mensagens (Q-PA-01), mascara o telefone e fica na auditoria', async () => {
    const ctx = testApp()
    try {
      const { sampleId } = upsertReviewSampleSync(ctx.boot.db, sample(), NOW)
      const res = await ctx.call(SUPER, `/api/platform/quality/samples/${sampleId}`)
      expect(res.status).toBe(200)
      const body = await json(res)
      expect(body.sample.messages.map((m: Json) => [m.direction, m.body])).toEqual([
        ['inbound', 'quero cotovelo'],
        ['outbound', 'Não encontrei cotovelo nas opções.'],
      ])
      expect(body.sample.contactPhoneMasked).toBe('••••0001')
      expect(JSON.stringify(body)).not.toContain('5511999990001')
      const audit = listAuditForTenant(ctx.boot.db, 'clinic-demo-a', { limit: 10 }).filter((e) => e.action === 'review.sample.read')
      expect(audit).toHaveLength(1)
      expect(audit[0]).toMatchObject({ actorClerkUserId: SUPER, objectType: 'review_sample', objectId: sampleId, outcome: 'success' })
      // A lista não é uma leitura de texto: não audita.
      await ctx.call(SUPER, '/api/platform/quality/samples')
      expect(listAuditForTenant(ctx.boot.db, 'clinic-demo-a', { limit: 10 }).filter((e) => e.action === 'review.sample.read')).toHaveLength(1)
    } finally {
      ctx.close()
    }
  })

  it('amostra inexistente ou expirada dá 404 e não audita', async () => {
    const ctx = testApp()
    try {
      const { sampleId } = upsertReviewSampleSync(ctx.boot.db, sample(), NOW)
      expect((await ctx.call(SUPER, '/api/platform/quality/samples/nao-existe')).status).toBe(404)
      ctx.clock.advance(REVIEW_SAMPLE_TTL_MS + 1000)
      expect((await ctx.call(SUPER, `/api/platform/quality/samples/${sampleId}`)).status).toBe(404)
      expect(listAuditForTenant(ctx.boot.db, 'clinic-demo-a', { limit: 10 }).some((e) => e.action === 'review.sample.read')).toBe(false)
    } finally {
      ctx.close()
    }
  })

  it('só o superadmin: owners e flags não booleanas recebem 403 e nada é auditado', async () => {
    const ctx = testApp()
    try {
      const { sampleId } = upsertReviewSampleSync(ctx.boot.db, sample(), NOW)
      for (const user of ['user_synth_owner_a', 'user_synth_string_super', 'user_synth_public_super']) {
        for (const p of ['/api/platform/quality/metrics', '/api/platform/quality/samples', `/api/platform/quality/samples/${sampleId}`]) {
          expect((await ctx.call(user, p)).status, `${user} ${p}`).toBe(403)
        }
      }
      expect(listAuditForTenant(ctx.boot.db, 'clinic-demo-a', { limit: 10 }).some((e) => e.action === 'review.sample.read')).toBe(false)
    } finally {
      ctx.close()
    }
  })

  it('maskPhone: só os últimos 4 dígitos', () => {
    expect(maskPhone('5511999990001')).toBe('••••0001')
    expect(maskPhone('+55 (11) 99999-0001')).toBe('••••0001')
    expect(maskPhone('123')).toBe('••••')
    expect(maskPhone(null)).toBeNull()
  })
})
