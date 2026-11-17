/**
 * Staging rsamp_f72ce5908371eff3a9757281 — seq 70–99 (17/11/2026).
 * «depois das X», FAQ «o que inclui», typo «incluinnariz».
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import {
  replaceServiceZonesOp,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import { listServices } from '../config/services'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { offerNearestSlots } from './slot-offer'
import { notBeforeTimeFromText } from './nlu/temporal'
import { tryAiAutoBook } from './autobook'
import { loadTurnContext } from './turn-context'
import { insertMessage } from '../inbox/messages'
import { saveBookingFrame } from './schedule-session'

const TZ = 'America/Sao_Paulo'
/** Qui 19/11/2026 10:00 SP — sexta 20/11 no futuro próximo */
const NOW = Date.UTC(2026, 10, 19, 13, 0)

function seedDepiFriday() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-rsamp-f72ce590'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'b_rsamp_f72',
      phoneNumberId: 'p_rsamp',
      wabaId: 'w_rsamp',
      displayPhone: '+5511999005500',
      displayName: 'Clínica',
      action: 'channel_connected',
    },
    clock,
  )
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Luiza' }, clock)
  const depi = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação',
      durationMinutes: 15,
      bufferMinutes: 0,
      priceCents: null,
      variantKind: 'zona',
      variantKindPlural: 'zonas',
      variantSelection: 'varias',
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
      clientExplanation:
        'Depilação íntima com cera nas regiões íntimas, virilha e períneo (dados fictícios).',
    },
    clock,
  )
  replaceServiceZonesOp(
    db,
    caller,
    depi.id,
    [
      { name: 'Pernas', audience: 'masculino', durationMinutes: 35, priceCents: 14_000 },
      { name: 'Costas', audience: 'masculino', durationMinutes: 25, priceCents: 11_000 },
      {
        name: 'Íntima',
        audience: 'masculino',
        durationMinutes: 20,
        priceCents: 18_000,
        clientExplanation: 'Inclui virilha e ânus.',
      },
    ],
    clock,
  )
  setWeeklyWindowsOp(
    db,
    caller,
    {
      resourceId: pro.id,
      windows: [1, 2, 3, 4, 5, 6].map((d) => ({
        dayOfWeek: d,
        startMinute: 9 * 60,
        endMinute: 18 * 60,
      })),
    },
    clock,
  )
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511999005501', displayName: 'Paulo' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  const friday = '2026-11-20'
  const depiLoaded = listServices(db, tenantId).find((s) => s.id === depi.id)!
  const zones = depiLoaded.zones.filter((z) => z.active)
  return { ...boot, clock, db, tenantId, caller, depi: depiLoaded, pro, cnv, contact, friday, zones }
}

async function autoBookBody(
  s: ReturnType<typeof seedDepiFriday>,
  body: string,
): Promise<string> {
  const inbound = insertMessage(
    s.db,
    {
      tenantId: s.tenantId,
      conversationId: s.cnv.id,
      direction: 'inbound',
      body,
      deliveryState: 'received',
      createdAt: s.clock.nowMs() + 1,
    },
    s.clock,
  )
  const turn = loadTurnContext(
    s.db,
    s.tenantId,
    {
      conversationId: s.cnv.id,
      contactId: s.contact.id,
      messageId: inbound.id,
      inboundBody: inbound.body,
    },
    s.clock,
  )
  const booked = await tryAiAutoBook(s.db, s.caller, s.clock, {
    conversationId: s.cnv.id,
    enabled: true,
    capability: true,
    turn,
    confirmationMessageIdOverride: inbound.id,
    turnTextOverride: body,
  })
  return booked.replyText ?? ''
}

describe('rsamp_f72ce590 — «depois das X» (horários)', () => {
  it('«depois das 10» exclui 10:00 (só 10:30)', async () => {
    expect(notBeforeTimeFromText('Depois das 10 tem algum horário?')).toBe('10:00')
    const s = seedDepiFriday()
    const intima = s.zones.find((z) => z.name === 'Íntima')!
    try {
      const offered = await offerNearestSlots({
        db: s.db,
        tenantId: s.tenantId,
        service: { ...s.depi, zones: [intima] },
        zones: [intima],
        tz: TZ,
        clock: s.clock,
        professionalId: s.pro.id,
        date: s.friday,
        period: 'manha',
        notBeforeHHMM: '10:00',
        conversationId: s.cnv.id,
        limit: 5,
      })
      expect(offered.slots.length).toBeGreaterThan(0)
      expect(offered.slots.map((x) => x.time)).not.toContain('10:00')
      expect(offered.slots.every((x) => x.time > '10:00')).toBe(true)
    } finally {
      s.close()
    }
  })

  it('«depois das 11:45» sem vaga de manhã: tarde + alternativa matinal (zona curta)', async () => {
    const s = seedDepiFriday()
    const intima = s.zones.find((z) => z.name === 'Íntima')!
    try {
      const offered = await offerNearestSlots({
        db: s.db,
        tenantId: s.tenantId,
        service: { ...s.depi, zones: [intima] },
        zones: [intima],
        tz: TZ,
        clock: s.clock,
        professionalId: s.pro.id,
        date: s.friday,
        period: 'manha',
        notBeforeHHMM: '11:45',
        conversationId: s.cnv.id,
        limit: 3,
      })
      expect(notBeforeTimeFromText('Depois das 11?')).toBe('11:00')
      expect(offered.replyText).toMatch(/Depois das 11:45 de manhã não tenho horário livre/i)
      expect(offered.replyText).toMatch(/mais perto de manhã é (?:10:30|11:00|11:30)/i)
      expect(offered.replyText).toMatch(/13:00/)
      expect(offered.slots.map((x) => x.time)).not.toContain('11:45')
      expect(offered.slots.map((x) => x.time)).toEqual(
        expect.arrayContaining(['11:30', '13:00']),
      )
    } finally {
      s.close()
    }
  })
})

describe('rsamp_f72ce590 — FAQ íntima', () => {
  it('«O que inclui a depilação íntima?» devolve explicação do serviço', async () => {
    const s = seedDepiFriday()
    try {
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.depi.id,
          line: 'masculino',
          phase: 'coletando',
          variantIds: s.zones.map((z) => z.id),
        },
        s.clock,
      )
      const reply = await autoBookBody(s, 'O que inclui a depilação íntima?')
      expect(reply).toMatch(/virilha|períneo|cera/i)
      expect(reply).not.toMatch(/faz parte de íntima/i)
      expect(reply).not.toMatch(/\bdepilacao\b/i)
    } finally {
      s.close()
    }
  })

  it('«Íntima incluinnariz?» entende inclusão (nariz → missing determinístico)', async () => {
    const s = seedDepiFriday()
    try {
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.depi.id,
          line: 'masculino',
          phase: 'coletando',
          variantIds: [s.zones[2]!.id],
        },
        s.clock,
      )
      const reply = await autoBookBody(s, 'Íntima incluinnariz?')
      expect(reply).not.toMatch(/Não peguei bem/i)
      expect(reply).toMatch(/não tenho esse detalhe|equipe confirma/i)
    } finally {
      s.close()
    }
  })
})