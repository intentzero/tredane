/**
 * DEC-145 — staging após #602: modo `uma` (Massagem).
 * Copy singular, Opções sem Todas, e pergunta de outro dia em texto livre
 * com variante travada + oferta de Horários (não «Não encontrei tem/feira»).
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter } from '../../ai'
import { createControllableClock } from '../../db/clock'
import {
  listServices,
  replaceServiceZonesOp,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import {
  TODAS_OPTION_KEY,
  VARIANT_LIST_BUTTON_LABEL,
  buildVariantChoiceInteractive,
} from './choice-offer'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'
import { getScheduleSession, saveScheduleSession } from './schedule-session'
import { variantKindForAsk, variantListQuestion } from './variant-line'

// Segunda de manhã: a oferta inicial traz seg/ter — «quarta» não está na lista pendente
// (como no staging com «segunda 09/11…»), e o texto livre é o caminho para outro dia.
const NOW = Date.UTC(2026, 9, 26, 12, 0) // seg 26/10/2026 ~09:00 BRT

function seedMassagemUma() {
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
      bindingId: 'bind_uma',
      phoneNumberId: 'pn_uma',
      wabaId: 'waba_uma',
      displayPhone: '+5511900000099',
      displayName: 'Clínica Uma',
      action: 'channel_connected',
    },
    clock,
  )
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1', category: 'Sala' }, clock)
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Bia', homeRoomId: room.id }, clock)
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Massagem',
      durationMinutes: 50,
      bufferMinutes: 0,
      priceCents: 15000,
      variantKind: 'tipo',
      variantKindPlural: 'tipos',
      variantSelection: 'uma',
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  replaceServiceZonesOp(
    db,
    caller,
    svc.id,
    [
      { name: 'Liberação miofascial', audience: 'ambos', durationMinutes: 50, priceCents: 15_000 },
      { name: 'Ventosaterapia', audience: 'ambos', durationMinutes: 45, priceCents: 14_000 },
      { name: 'Drenagem linfática', audience: 'ambos', durationMinutes: 50, priceCents: 16_000 },
      { name: 'Massagem relaxante', audience: 'ambos', durationMinutes: 50, priceCents: 15_000 },
    ],
    clock,
  )
  const refreshed = listServices(db, tenantId).find((row) => row.id === svc.id)
  if (!refreshed) throw new Error('Massagem ausente após zonas')
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1020 }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000099', displayName: 'Carla Demo' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  const relaxante = refreshed.zones.find((z) => z.name === 'Massagem relaxante')
  if (!relaxante) throw new Error('Massagem relaxante ausente')
  return { ...boot, clock, tenantId, caller, cnv, svc: refreshed, relaxante }
}

async function say(s: ReturnType<typeof seedMassagemUma>, body: string) {
  s.clock.advance(60_000)
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
  const out = await runDueAutoDrafts(s.db, s.caller, s.clock, {
    mode: 'synthetic',
    adapter: new SimulatedAiAdapter(),
  })
  return out[0]!
}

function lastInteractive(s: ReturnType<typeof seedMassagemUma>) {
  const row = s.db.get<{ interactive_json: string | null }>(
    `SELECT interactive_json FROM outbound_messages WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1`,
    s.tenantId,
  )
  if (!row?.interactive_json) return null
  return JSON.parse(row.interactive_json) as {
    type?: string
    action?: {
      button?: string
      sections?: Array<{ rows?: Array<{ id?: string; title?: string }> }>
    }
  }
}

describe('DEC-145 staging: Massagem modo uma', () => {
  it('pergunta o tipo no singular e a lista Opções não tem Todas', async () => {
    const s = seedMassagemUma()
    try {
      const result = await say(s, 'Queria agendar uma massagem')
      const reply = result.autoBook?.replyText ?? ''
      expect(reply).toMatch(/\bqual tipo\b/i)
      expect(reply).not.toMatch(/\bquais tipos?\b/i)
      expect(reply).not.toMatch(/Pode ser mais de uma/i)

      const kind = variantKindForAsk(s.svc)
      expect(kind).toBe('tipo')
      const ask = variantListQuestion(s.svc.name, kind, s.svc.zones.filter((z) => z.active), 'cnv', {
        selectionMode: 'uma',
      })
      expect(ask).toMatch(/\bqual tipo\b/i)

      const built = buildVariantChoiceInteractive({
        catalogVersion: '1',
        zones: s.svc.zones.filter((z) => z.active).map((z) => ({ id: z.id, name: z.name })),
        includeTodas: false,
      })
      expect(built.pending.options.every((o) => o.key !== TODAS_OPTION_KEY)).toBe(true)
      expect(built.interactive.button).toBe(VARIANT_LIST_BUTTON_LABEL)

      const interactive = lastInteractive(s)
      const rows = interactive?.action?.sections?.flatMap((sec) => sec.rows ?? []) ?? []
      expect(rows.every((r) => r.title !== 'Todas')).toBe(true)
      expect(rows.every((r) => !(r.id ?? '').includes('todas'))).toBe(true)
    } finally {
      s.close()
    }
  }, 30_000)

  it('modo varias ainda inclui Todas (regressão)', () => {
    const built = buildVariantChoiceInteractive({
      catalogVersion: '1',
      zones: [
        { id: 'a', name: 'Axila' },
        { id: 'b', name: 'Pernas' },
      ],
      includeTodas: true,
    })
    expect(built.pending.options.at(-1)?.key).toBe(TODAS_OPTION_KEY)
    expect(built.interactive.sections.flatMap((sec) => sec.rows).at(-1)?.title).toBe('Todas')
  })

  it.each([
    // Âncora: seg 26/10 → «próxima quarta» / «Quarta feira» = 28/10 (não está nos primeiros slots).
    'Tem horário na próxima quarta?',
    'Quarta feira tem horário?',
  ] as const)(
    'após Massagem relaxante + oferta, «%s» mantém a variante e oferece quarta',
    async (ask) => {
      const s = seedMassagemUma()
      try {
        saveScheduleSession(
          s.db,
          s.tenantId,
          s.cnv.id,
          {
            serviceId: s.svc.id,
            phase: 'coletando',
            variantIds: [s.relaxante.id],
          },
          s.clock,
        )
        const offered = await say(s, 'Massagem relaxante')
        const offerText = offered.autoBook?.replyText ?? ''
        expect(offerText).not.toMatch(/Não encontrei/i)
        expect(offerText).toMatch(/tenho|\d{1,2}:\d{2}/i)
        expect(offerText).not.toMatch(/outro dia/i)
        // Espelha o staging: a lista aberta é dos próximos (seg…), sem quarta.
        expect(offerText).not.toMatch(/quarta\s+28\/10/i)

        const day = await say(s, ask)
        const reply = day.autoBook?.replyText ?? ''
        expect(reply).not.toMatch(/Não encontrei\s+(tem|feira)/i)
        expect(reply).not.toMatch(/Quer Liberação miofascial/i)
        expect(reply).not.toMatch(/\bquais tipos?\b/i)
        expect(reply).not.toMatch(/\bqual tipo\b/i)
        expect(reply).toMatch(/quarta\s+28\/10/i)
        expect(reply).toMatch(/tenho|vaga|\d{1,2}:\d{2}/i)

        const session = getScheduleSession(s.db, s.tenantId, s.cnv.id)
        expect(session?.variantIds).toEqual([s.relaxante.id])

        const dayInteractive = lastInteractive(s)
        const rows = dayInteractive?.action?.sections?.flatMap((sec) => sec.rows ?? []) ?? []
        if (rows.length > 0) {
          expect(rows.every((r) => /quarta|28\/10/i.test(r.title ?? ''))).toBe(true)
        }
      } finally {
        s.close()
      }
    },
    30_000,
  )
})
