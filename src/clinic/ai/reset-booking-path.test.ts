/**
 * Pacote reset Confirmado (Paulo «Sim» 09/11/2026):
 * B2 outro agendamento; silencioso period; T1 Manhã|Tarde|Outro dia; discovery hint.
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter } from '../../ai'
import { createControllableClock } from '../../db/clock'
import { replaceServiceZonesOp, setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { catalogConsultIntent } from './catalog-consult'
import {
  PERIOD_DAY_MANHA_LABEL,
  PERIOD_DAY_OUTRO_DIA_LABEL,
  PERIOD_DAY_TARDE_LABEL,
  buildPeriodDayInteractive,
  parseChoiceId,
} from './choice-offer'
import { RESET_DISCOVERY_HINT_TEXT } from './end-help-hint'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'
import { getBookingFrame, saveBookingFrame } from './schedule-session'

/** seg 09/11/2026 18:40 America/Sao_Paulo. */
const NOW = Date.UTC(2026, 10, 9, 21, 40)

function seed() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-reset-path'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'b_reset',
      phoneNumberId: 'p_reset',
      wabaId: 'w_reset',
      displayPhone: '+5511900000099',
      displayName: 'C',
      action: 'channel_connected',
    },
    clock,
  )
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1', category: 'Sala' }, clock)
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi', homeRoomId: room.id }, clock)
  const depilacao = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação',
      durationMinutes: 30,
      bufferMinutes: 0,
      priceCents: 8000,
      variantKind: 'zona',
      variantKindPlural: 'zonas',
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  const zones = replaceServiceZonesOp(
    db,
    caller,
    depilacao.id,
    [
      { name: 'Axila', durationMinutes: 15, priceCents: 4000, audience: 'feminino' },
      { name: 'Pernas', durationMinutes: 30, priceCents: 9000, audience: 'feminino' },
    ],
    clock,
  )
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1020 }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000099', displayName: 'Demo' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  const axila = zones.find((z) => z.name === 'Axila')!
  const pernas = zones.find((z) => z.name === 'Pernas')!
  return { ...boot, clock, tenantId, caller, cnv, depilacao, axila, pernas }
}

async function say(s: ReturnType<typeof seed>, body: string) {
  s.clock.advance(30_000)
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

describe('reset booking path (Paulo 09/11/2026)', () => {
  it('B2: frases «outro agendamento» são catalog consult', () => {
    for (const text of [
      'quero outro agendamento',
      'outro agendamento',
      'quero marcar outro',
      'quero marcar outra coisa',
      'nova marcação',
      'quero agendar de novo',
    ]) {
      expect(catalogConsultIntent(text), text).toEqual({ kind: 'ask' })
    }
  })

  it('B2: «marcar outro horário/dia/período» não limpa o funil', () => {
    for (const text of [
      'quero marcar outro horário',
      'quero marcar outro dia',
      'quero marcar outro período',
      'quero marcar outra data',
      'quero marcar outra sessão de limpeza',
    ]) {
      expect(catalogConsultIntent(text), text).toBeNull()
    }
  })

  it('T1: botões Manhã | Tarde | Outro dia', () => {
    const built = buildPeriodDayInteractive('v1')
    expect(built.interactive.mode).toBe('buttons')
    expect(built.interactive.buttons.map((b) => b.title)).toEqual([
      PERIOD_DAY_MANHA_LABEL,
      PERIOD_DAY_TARDE_LABEL,
      PERIOD_DAY_OUTRO_DIA_LABEL,
    ])
    for (const b of built.interactive.buttons) {
      expect(parseChoiceId(b.id)?.slot).toBe('periodo')
    }
    expect(built.pending.slot).toBe('periodo')
  })

  it('silencioso 1: eco Sim não herda period=noite', async () => {
    const s = seed()
    try {
      const eco = insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'outbound',
          body: 'Entendi: axila, pernas. Certo?',
          deliveryState: 'delivered',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.depilacao.id,
          line: 'feminino',
          variantIds: [s.axila.id, s.pernas.id],
          period: 'noite',
          phase: 'coletando',
          pending: {
            slot: 'eco',
            options: [
              { key: 'sim', label: 'Sim' },
              { key: 'corrigir', label: 'Corrigir' },
            ],
            messageId: eco.id,
          },
        },
        s.clock,
      )
      const out = await say(s, 'Sim')
      const reply = out.autoBook?.replyText ?? ''
      expect(reply).toMatch(/\d{1,2}:\d{2}/)
      expect(reply).not.toMatch(/à noite não tenho/i)
      expect(reply).not.toMatch(/outro período\?/i)
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.period).toBeNull()
    } finally {
      s.close()
    }
  })

  it('silencioso 1: período nomeado antes do eco («à tarde») sobrevive ao Sim', async () => {
    const s = seed()
    try {
      await say(s, 'Quero depilação feminina de axila e pernas sexta à tarde')
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.period).toBe('tarde')
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.pending?.slot).toBe('eco')
      await say(s, 'sim')
      const frame = getBookingFrame(s.db, s.tenantId, s.cnv.id)
      expect(frame?.period).toBe('tarde')
      expect(frame?.pending?.slot).toBe('horario')
      const offered = frame?.lastOffer?.slots ?? []
      expect(offered.length).toBeGreaterThan(0)
      // Sexta à tarde (SP): startsAt local hour ≥ 12 — não reabrir manhã.
      expect(
        offered.every((slot) => {
          const localHour = Number(
            new Intl.DateTimeFormat('en-US', {
              timeZone: 'America/Sao_Paulo',
              hour: 'numeric',
              hour12: false,
            }).format(new Date(slot.startsAt)),
          )
          return localHour >= 12
        }),
      ).toBe(true)
    } finally {
      s.close()
    }
  })

  it('silencioso 2 + T1: período vazio auto-avança ou oferece Manhã|Tarde|Outro dia', async () => {
    const s = seed()
    try {
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.depilacao.id,
          line: 'feminino',
          variantIds: [s.axila.id, s.pernas.id],
          date: '2026-11-10',
          period: 'noite',
          phase: 'coletando',
        },
        s.clock,
      )
      // Sem outbound «Quer ver outro período?» — pedido de horários com noite sticky.
      const out = await say(s, 'tem horário?')
      const reply = out.autoBook?.replyText ?? ''
      expect(reply).not.toMatch(/Quer ver outro período\?/i)
      const interactive = out.autoBook?.interactive
      if (interactive?.mode === 'list') {
        // Auto-avançou para próximos (manhã/tarde).
        expect(reply).toMatch(/\d{1,2}:\d{2}/)
        expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.period).toBeNull()
      } else {
        expect(interactive?.mode).toBe('buttons')
        const titles =
          interactive?.mode === 'buttons' ? interactive.buttons.map((b) => b.title) : []
        expect(titles).toEqual([
          PERIOD_DAY_MANHA_LABEL,
          PERIOD_DAY_TARDE_LABEL,
          PERIOD_DAY_OUTRO_DIA_LABEL,
        ])
      }
    } finally {
      s.close()
    }
  })

  it('B2 mid-funnel: «quero outro agendamento» não vira zona miss', async () => {
    const s = seed()
    try {
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.depilacao.id,
          line: 'feminino',
          variantIds: [s.axila.id, s.pernas.id],
          phase: 'coletando',
        },
        s.clock,
      )
      const out = await say(s, 'Quero outro agendamento')
      const bodies = s.db
        .all<{ body: string }>(
          `SELECT body FROM messages WHERE conversation_id = ? AND direction = 'outbound' ORDER BY created_at DESC LIMIT 2`,
          s.cnv.id,
        )
        .map((r) => r.body)
        .join('\n')
      const reply = out.autoBook?.replyText ?? bodies
      expect(reply).not.toMatch(/Não encontrei agendamento/i)
      expect(reply).toMatch(/Continuo no feminino|Temos:|Feminino ou masculino/i)
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.serviceId).toBeNull()
    } finally {
      s.close()
    }
  })

  it('discovery hint text is fixed', () => {
    expect(RESET_DISCOVERY_HINT_TEXT).toBe(
      'Para recomeçar, diga começar de novo. Para parar, diga terminar.',
    )
  })
})
