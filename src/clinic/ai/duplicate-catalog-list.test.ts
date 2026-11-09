/**
 * Staging Paulo ~13:42 SP 09/11/2026: após «Feminino ou masculino?» + Escolher
 * «Masculino», saíram **duas** listas idênticas «Temos: … Qual você quer?».
 *
 * Mesma classe de race que #640/#641: ingest do `list_reply` grava
 * `[Lista] Masculino` e enfileira autodraft; `handleCatalogAudienceClick`
 * (via choice) também realiza a lista. Sem `interactive_reply_button`, o
 * alarme pode ganhar e `planCatalogConsult` (pending audiencia +
 * explicitAudienceLine) manda um «Temos:» antes/depois do clique.
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter } from '../../ai'
import { createControllableClock } from '../../db/clock'
import { setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import {
  CATALOG_AUDIENCE_LIST_BODY,
  CATALOG_AUDIENCE_LIST_BUTTON,
  CATALOG_AUDIENCE_ROW_MASCULINO,
  catalogNamesBody,
} from './catalog-consult'
import { handleChoiceOfferClick } from './choice-offer'
import { enqueueAutoDraft, getAutoDraftJob, runDueAutoDrafts } from './index'

const NOW = Date.UTC(2026, 10, 5, 13, 0)

function seed() {
  const clock = createControllableClock(NOW - 10 * 60_000)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-a'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_dup_catalog',
      phoneNumberId: 'pn_dup_catalog',
      wabaId: 'waba_dup_catalog',
      displayPhone: '+5511900000077',
      displayName: 'Clínica Dup Catalog',
      action: 'channel_connected',
    },
    clock,
  )
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1', category: 'Sala' }, clock)
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi', homeRoomId: room.id }, clock)
  for (const name of ['Depilação', 'Massagem'] as const) {
    const svc = upsertServiceOp(
      db,
      caller,
      {
        name,
        durationMinutes: 30,
        bufferMinutes: 0,
        priceCents: 8000,
        professionalIds: [pro.id],
        roomRequirement: { mode: 'none' },
      },
      clock,
    )
    db.run(`UPDATE services SET audiencia = 'qualquer' WHERE id = ?`, svc.id)
  }
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1020 }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000077', displayName: 'Paulo Demo' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  clock.advance(60_000)
  return { ...boot, clock, tenantId, caller, cnv, db }
}

async function say(s: ReturnType<typeof seed>, body: string) {
  insertMessage(
    s.db,
    {
      tenantId: s.tenantId,
      conversationId: s.cnv.id,
      direction: 'inbound',
      body,
      deliveryState: 'received',
      createdAt: s.clock.nowMs(),
    },
    s.clock,
  )
  const last = s.db.get<{ id: string }>(
    `SELECT id FROM messages WHERE conversation_id = ? AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1`,
    s.cnv.id,
  )!
  enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.cnv.id, messageId: last.id }, s.clock)
  s.clock.advance(7_000)
  return runDueAutoDrafts(s.db, s.caller, s.clock, {
    mode: 'synthetic',
    adapter: new SimulatedAiAdapter(),
  })
}

function outbound(s: ReturnType<typeof seed>) {
  return s.db.all<{ body: string; kind: string; interactive_json: string | null }>(
    `SELECT m.body AS body, o.kind AS kind, o.interactive_json AS interactive_json
     FROM outbound_messages o
     JOIN messages m ON m.id = o.message_id
     WHERE o.tenant_id = ?
     ORDER BY o.created_at, o.rowid`,
    s.tenantId,
  )
}

function catalogLists(rows: ReturnType<typeof outbound>) {
  return rows.filter((m) => /^Temos:\n/.test(m.body) && /Qual você quer\?/.test(m.body))
}

function masculinoRowId(json: string | null): string {
  const parsed = JSON.parse(json ?? '{}') as {
    list?: { sections?: Array<{ rows?: Array<{ id: string; title: string }> }> }
  }
  const row = parsed.list?.sections?.[0]?.rows?.find((r) => r.title === CATALOG_AUDIENCE_ROW_MASCULINO)
  expect(row?.id).toBeTruthy()
  return row!.id
}

async function reachAudienceList(s: ReturnType<typeof seed>) {
  await say(s, 'quais serviços você tem?')
  const ask = outbound(s).at(-1)
  expect(ask?.body).toBe(CATALOG_AUDIENCE_LIST_BODY)
  expect(ask?.interactive_json ?? '').toContain(CATALOG_AUDIENCE_LIST_BUTTON)
  expect(ask?.interactive_json ?? '').toContain(CATALOG_AUDIENCE_ROW_MASCULINO)
  return ask!
}

const EXPECTED_LIST = catalogNamesBody(['Depilação', 'Massagem'])

describe('lista de catálogo única após Escolher Masculino (DEC-142)', () => {
  it('texto «Masculino» após a pergunta manda um só «Temos:»', async () => {
    const s = seed()
    try {
      await reachAudienceList(s)
      const before = outbound(s).length
      await say(s, 'Masculino')
      const lists = catalogLists(outbound(s).slice(before))
      expect(lists).toHaveLength(1)
      expect(lists[0]!.body).toBe(EXPECTED_LIST)
      expect(lists[0]!.interactive_json).toBeNull()
    } finally {
      s.close()
    }
  })

  it('produção: ingest [Lista] Masculino + toque → um «Temos:» (job cancelado)', async () => {
    const s = seed()
    try {
      const ask = await reachAudienceList(s)
      const id = masculinoRowId(ask.interactive_json)
      s.clock.advance(1_000)
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: `[Lista] ${CATALOG_AUDIENCE_ROW_MASCULINO}`,
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      const last = s.db.get<{ id: string }>(
        `SELECT id FROM messages WHERE conversation_id = ? AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1`,
        s.cnv.id,
      )!
      enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.cnv.id, messageId: last.id }, s.clock)
      expect(getAutoDraftJob(s.db, s.tenantId, s.cnv.id)).not.toBeNull()

      const before = outbound(s).length
      const clicked = await handleChoiceOfferClick(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          buttonId: id,
          providerEventKey: 'catalog-masc-prod',
        },
        s.clock,
      )
      expect(clicked.handled).toBe(true)
      expect(getAutoDraftJob(s.db, s.tenantId, s.cnv.id)).toBeNull()
      s.clock.advance(7_000)
      const outcomes = await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: new SimulatedAiAdapter(),
      })
      expect(outcomes).toHaveLength(0)
      const lists = catalogLists(outbound(s).slice(before))
      expect(lists).toHaveLength(1)
      expect(lists[0]!.body).toBe(EXPECTED_LIST)
    } finally {
      s.close()
    }
  })

  it('race: autodraft de [Lista] Masculino antes do click não emite «Temos:»; o click emite um', async () => {
    const s = seed()
    try {
      const ask = await reachAudienceList(s)
      const id = masculinoRowId(ask.interactive_json)
      s.clock.advance(1_000)
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: `[Lista] ${CATALOG_AUDIENCE_ROW_MASCULINO}`,
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      const last = s.db.get<{ id: string }>(
        `SELECT id FROM messages WHERE conversation_id = ? AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1`,
        s.cnv.id,
      )!
      enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.cnv.id, messageId: last.id }, s.clock)
      const before = outbound(s).length
      s.clock.advance(7_000)
      const outcomes = await runDueAutoDrafts(s.db, s.caller, s.clock, {
        mode: 'synthetic',
        adapter: new SimulatedAiAdapter(),
      })
      expect(outcomes.some((o) => o.reason === 'interactive_reply_button')).toBe(true)
      expect(catalogLists(outbound(s).slice(before))).toHaveLength(0)

      const clicked = await handleChoiceOfferClick(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          buttonId: id,
          providerEventKey: 'catalog-masc-race',
        },
        s.clock,
      )
      expect(clicked.handled).toBe(true)
      const lists = catalogLists(outbound(s).slice(before))
      expect(lists).toHaveLength(1)
      expect(lists[0]!.body).toBe(EXPECTED_LIST)
    } finally {
      s.close()
    }
  })
})
