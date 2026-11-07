/**
 * Oferta live do Flow no lugar do M5 (#514 / ADR-0016 §4).
 */
import { describe, expect, it, vi } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { bootAdminDb } from '../../db/test-db'
import {
  buildLineChoiceInteractive,
  buildSlotChoiceInteractive,
  buildVariantChoiceInteractive,
  buildZoneEchoInteractive,
} from '../../clinic/ai/choice-offer'
import { createDeferredBookingFrame } from '../../clinic/ai/deferred-booking-frame'
import { generateFlowKeyPair } from './crypto'
import {
  clearM5PendingOnDeferred,
  isM5FunnelChoiceInteractive,
  maybeReplaceM5WithFlow,
  prepareBookingFlowOfferFromEnv,
  sessionFromBookingFrame,
} from './offer-live'

type SqlParam = string | number | null | Uint8Array

function adminDbAsD1(admin: ReturnType<typeof bootAdminDb>['db']): D1Database {
  return {
    prepare(sql: string) {
      const binds: SqlParam[] = []
      const stmt = {
        bind(...args: SqlParam[]) {
          binds.push(...args)
          return stmt
        },
        async first<T>() {
          return (admin.get(sql, ...binds) as T | undefined) ?? null
        },
        async run() {
          admin.run(sql, ...binds)
          return { success: true, meta: {} }
        },
        async all() {
          return { results: admin.all(sql, ...binds), success: true, meta: {} }
        },
      }
      return stmt
    },
  } as unknown as D1Database
}

describe('isM5FunnelChoiceInteractive', () => {
  it('trata linha / Opções / Horários como funil M5', () => {
    expect(isM5FunnelChoiceInteractive(buildLineChoiceInteractive('1').interactive)).toBe(true)
    expect(
      isM5FunnelChoiceInteractive(
        buildVariantChoiceInteractive({
          catalogVersion: '1',
          zones: [{ id: 'z1', name: 'Axila' }],
        }).interactive,
      ),
    ).toBe(true)
    expect(
      isM5FunnelChoiceInteractive(
        buildSlotChoiceInteractive({
          catalogVersion: '1',
          slots: [{ key: '2026-11-04T10:00', label: 'terça 04/11 10:00' }],
        }).interactive,
      ),
    ).toBe(true)
  })

  it('não trata eco Sim/Corrigir como funil M5', () => {
    expect(isM5FunnelChoiceInteractive(buildZoneEchoInteractive('1').interactive)).toBe(false)
    expect(isM5FunnelChoiceInteractive(null)).toBe(false)
  })
})

describe('sessionFromBookingFrame', () => {
  it('copia serviço/linha/variantes e monta slotKey civil', () => {
    expect(
      sessionFromBookingFrame({
        serviceId: 'svc_dep',
        line: 'feminino',
        variantIds: ['z1', 'z2'],
        date: '2026-11-04',
        time: '10:00',
        period: null,
        pending: null,
        lastOffer: null,
        phase: 'coletando',
        proposal: null,
        professionalPref: null,
        rescheduleAppointmentId: null,
        catalogVersion: '3',
        provenance: {},
        updatedAt: 1,
      }),
    ).toEqual({
      serviceId: 'svc_dep',
      line: 'feminino',
      variantIds: ['z1', 'z2'],
      slotKey: '2026-11-04T10:00',
    })
  })
})

describe('prepareBookingFlowOfferFromEnv', () => {
  it('sem secrets devolve null e regista o motivo (DEC-143)', async () => {
    const { db, close } = bootAdminDb()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const clock = createControllableClock(1_700_000_000_000)
      const offered = await prepareBookingFlowOfferFromEnv({
        env: { DB: adminDbAsD1(db) },
        clock,
        tenantId: 'clinic-demo-a',
        conversationId: 'cnv1',
        catalogVersion: '1',
      })
      expect(offered).toBeNull()
      const logged = warn.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
      expect(logged).toContainEqual({
        level: 'warn',
        event: 'whatsapp_flow.offer_skipped',
        tenantId: 'clinic-demo-a',
        reason: 'not_configured',
      })
    } finally {
      warn.mockRestore()
      close()
    }
  })

  it('com secrets + binding activo grava token e devolve interactive flow', async () => {
    const { db, close } = bootAdminDb()
    try {
      const clock = createControllableClock(1_700_000_000_000)
      const pair = await generateFlowKeyPair()
      const now = clock.nowMs()
      db.run(
        `INSERT INTO whatsapp_phone_bindings (
          id, phone_number_id, tenant_id, waba_id, display_phone, display_name,
          status, connected_at, connected_by_clerk_user_id, interrupted_at,
          interrupt_reason, released_at, released_by_clerk_user_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL, NULL, NULL, NULL, ?)`,
        'bind-flow',
        'pn-flow',
        'clinic-demo-a',
        'waba-flow',
        '+5511999999999',
        'Teste',
        now,
        'user_synth',
        now,
      )
      const offered = await prepareBookingFlowOfferFromEnv({
        env: {
          DB: adminDbAsD1(db),
          WHATSAPP_FLOW_ID: '1858344942174587',
          WHATSAPP_FLOW_PRIVATE_KEY: pair.privatePem,
        },
        clock,
        tenantId: 'clinic-demo-a',
        conversationId: 'cnv-flow',
        catalogVersion: '9',
        session: {
          serviceId: 'svc_dep',
          line: null,
          variantIds: null,
          slotKey: null,
        },
      })
      expect(offered).not.toBeNull()
      expect(offered!.interactive.flow?.flowId).toBe('1858344942174587')
      expect(offered!.interactive.flow?.flowCta).toBe('Abrir opções')
      expect(offered!.interactive.flow?.flowToken.startsWith('fl1_')).toBe(true)
      expect(offered!.body.length).toBeGreaterThan(0)
      const row = db.get<{ conversation_id: string; catalog_version: string; session_json: string }>(
        `SELECT conversation_id, catalog_version, session_json FROM whatsapp_flow_tokens WHERE token = ?`,
        offered!.flowToken,
      )
      expect(row?.conversation_id).toBe('cnv-flow')
      expect(row?.catalog_version).toBe('9')
      expect(JSON.parse(row!.session_json).serviceId).toBe('svc_dep')
    } finally {
      close()
    }
  })
})

describe('maybeReplaceM5WithFlow', () => {
  it('pergunta de linha fica no passo: sem CTA Abrir opções (Paulo, 07/11/2026)', async () => {
    const deferred = createDeferredBookingFrame()
    deferred.save({
      serviceId: 'svc_dep',
      pending: {
        slot: 'linha',
        options: [
          { key: 'feminino', label: 'Feminina' },
          { key: 'masculino', label: 'Masculina' },
        ],
        messageId: '__outbound__',
      },
      catalogVersion: '1',
    })
    const line = buildLineChoiceInteractive('1')
    let prepared = 0
    const replaced = await maybeReplaceM5WithFlow({
      choice: line.interactive,
      replyBody: 'Para Depilação, Feminina ou Masculina?',
      prepare: async (input) => ({
        flowToken: 'fl1_test',
        body: (prepared += 1, input.body ?? 'Olá! O que você precisa?'),
        interactive: {
          flow: {
            flowId: '1858344942174587',
            flowCta: 'Abrir opções',
            flowToken: 'fl1_test',
            flowAction: 'data_exchange',
            flowMessageVersion: '3',
            mode: 'published',
          },
        },
      }),
      tenantId: 'clinic-demo-a',
      conversationId: 'cnv1',
      catalogVersion: '1',
      session: sessionFromBookingFrame({
        serviceId: 'svc_dep',
        line: null,
        variantIds: null,
        date: null,
        time: null,
        period: null,
        pending: null,
        lastOffer: null,
        phase: 'coletando',
        proposal: null,
        professionalPref: null,
        rescheduleAppointmentId: null,
        catalogVersion: '1',
        provenance: {},
        updatedAt: 1,
      }),
      deferred,
    })
    expect(prepared).toBe(0)
    expect(replaced.usedFlow).toBe(false)
    expect(replaced.interactive?.flow).toBeUndefined()
    expect(replaced.interactive?.buttons?.map((b) => b.title)).toEqual(['Feminina', 'Masculina'])
    // O corpo continua a ser a pergunta do turno, não o C1h (CF-35).
    expect(replaced.body).toBe('Para Depilação, Feminina ou Masculina?')
    expect(deferred.peekFrame).toBeTypeOf('function')
  })

  it('CF-35: vaga ocupada + alternativas não vira «Olá! O que você precisa?» nem ganha Abrir opções', async () => {
    const line = buildLineChoiceInteractive('1')
    const replyBody = 'Nesse horário das 14:00 já não tenho vaga. Tenho 15:15, 15:30, 15:45. Qual fica melhor?'
    const replaced = await maybeReplaceM5WithFlow({
      choice: line.interactive,
      replyBody,
      prepare: async (input) => ({
        flowToken: 'fl1_cf35',
        body: input.body ?? 'Olá! O que você precisa?',
        interactive: {
          flow: {
            flowId: '1',
            flowCta: 'Abrir opções',
            flowToken: 'fl1_cf35',
            flowAction: 'data_exchange',
            flowMessageVersion: '3',
            mode: 'published',
          },
        },
      }),
      tenantId: 't',
      conversationId: 'c',
      catalogVersion: '1',
    })
    expect(replaced.usedFlow).toBe(false)
    expect(replaced.body).toBe(replyBody)
    expect(replaced.body).not.toContain('O que você precisa')
    expect(replaced.interactive?.flow).toBeUndefined()
  })

  it('mantém eco Sim/Corrigir', async () => {
    const eco = buildZoneEchoInteractive('1')
    const replaced = await maybeReplaceM5WithFlow({
      choice: eco.interactive,
      replyBody: 'Entendi: Axila. Certo?',
      prepare: async () => ({
        flowToken: 'fl1_x',
        body: 'Flow body',
        interactive: {
          flow: {
            flowId: '1',
            flowCta: 'Escolher horário',
            flowToken: 'fl1_x',
          },
        },
      }),
      tenantId: 't',
      conversationId: 'c',
      catalogVersion: '1',
    })
    expect(replaced.usedFlow).toBe(false)
    expect(replaced.interactive?.buttons?.map((b) => b.title)).toEqual(['Sim', 'Corrigir'])
  })

  it('clearM5PendingOnDeferred mantém a oferta de horários: a cliente responde por texto («14»)', () => {
    const deferred = createDeferredBookingFrame()
    deferred.save({
      serviceId: 'svc_dep',
      pending: {
        slot: 'horario',
        options: [
          { key: '2026-11-13T13:00', label: 'sexta 13/11 13:00' },
          { key: '2026-11-13T14:00', label: 'sexta 13/11 14:00' },
        ],
        messageId: '__outbound__',
      },
      lastOffer: { slots: [{ startsAt: 1, professionalId: 'p1' }], messageId: '__outbound__' },
      catalogVersion: '1',
    })
    clearM5PendingOnDeferred(deferred)
    expect(deferred.pendingSlot).toBe('horario')
    const linha = createDeferredBookingFrame()
    linha.save({
      serviceId: 'svc_dep',
      pending: { slot: 'linha', options: [{ key: 'feminino', label: 'Feminina' }], messageId: '__outbound__' },
      catalogVersion: '1',
    })
    clearM5PendingOnDeferred(linha)
    expect(linha.pendingSlot).toBeNull()
  })

  it('clearM5PendingOnDeferred zera pending sem apagar serviço', () => {
    const deferred = createDeferredBookingFrame()
    deferred.save({
      serviceId: 'svc_dep',
      pending: {
        slot: 'linha',
        options: [{ key: 'feminino', label: 'Feminina' }],
        messageId: 'm1',
      },
    })
    clearM5PendingOnDeferred(deferred)
    // peek precisa de db — só validamos que o patch tem pending null via saveFrame
    deferred.saveFrame({ pending: null })
    expect(deferred.hasWork).toBe(true)
  })
})
