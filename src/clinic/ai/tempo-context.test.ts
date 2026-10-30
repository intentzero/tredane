/**
 * DEC-077 / S7 — a IA só vê horas que serviram e a frase do WhatsApp.
 * Texto livre não marca (DEC-061).
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter, type AiGenerateInput, type AiGenerateResult } from '../../ai'
import { createControllableClock } from '../../db/clock'
import {
  setForecastPlaceOp,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { TEMPO_REFUSED_PHRASE, TEMPO_UNCONFIRMED_PHRASE } from '../proposals/render'
import { bootClinicDb } from '../test-db'
import type { ForecastAdapter, SkySymbol } from '../tempo/evaluate'
import { buildClinicAiContext } from './schedule-context'
import { suggestReplyOp } from './index'

const CLOCK = Date.UTC(2024, 0, 8, 11, 0)

function reading(sky: SkySymbol, celsius: number): ForecastAdapter {
  return {
    async read() {
      return { ok: true as const, sky, celsius }
    },
  }
}

class FixedOutputAdapter extends SimulatedAiAdapter {
  constructor(private readonly out: string) {
    super()
  }
  override async generate(input: AiGenerateInput): Promise<AiGenerateResult> {
    const result = await super.generate(input)
    return result.ok ? { ...result, text: this.out } : result
  }
}

function seed(body: string) {
  const clock = createControllableClock(CLOCK)
  const boot = bootClinicDb({ clock })
  const tenantId = 'clinic-demo-a'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  const room = upsertResourceOp(boot.db, caller, { kind: 'room', name: 'Sala 1' }, clock)
  const pro = upsertResourceOp(
    boot.db,
    caller,
    { kind: 'professional', name: 'Gi', homeRoomId: room.id },
    clock,
  )
  setWeeklyWindowsOp(
    boot.db,
    caller,
    { resourceId: pro.id, windows: [{ dayOfWeek: 1, startMinute: 8 * 60, endMinute: 18 * 60 }] },
    clock,
  )
  upsertServiceOp(
    boot.db,
    caller,
    {
      name: 'Bronzeamento',
      durationMinutes: 60,
      bufferMinutes: 0,
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
      tempoCeu: 'sol',
      tempoTemperatura: 'acima',
      tempoCelsius: 24,
    },
    clock,
  )
  upsertServiceOp(
    boot.db,
    caller,
    {
      name: 'Depilação',
      durationMinutes: 60,
      bufferMinutes: 0,
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  setForecastPlaceOp(boot.db, caller, { mode: 'cidade', city: 'Campinas' }, clock)
  setClinicAiAssistEnabled(boot.db, tenantId, true, clock)
  const contact = upsertContact(boot.db, { tenantId, waId: '5511999000017', displayName: 'Ana' }, clock)
  const conversation = createConversation(boot.db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  insertMessage(
    boot.db,
    {
      tenantId,
      conversationId: conversation.id,
      direction: 'inbound',
      body,
      deliveryState: 'received',
      authorClerkUserId: null,
      authorDisplayName: null,
      createdAt: clock.nowMs(),
    },
    clock,
  )
  return { ...boot, clock, caller, tenantId, contact, conversation }
}

function reply(text: string) {
  return JSON.stringify({ mensagem: text, notas: '' })
}

describe('contexto da IA no bloco Tempo (S7)', () => {
  it('o pedido ao modelo só tem horas que serviram e a frase do WhatsApp, sem payload', async () => {
    const s = seed('Quero bronzeamento hoje às 15h')
    try {
      const shown = await suggestReplyOp(
        s.db,
        s.caller,
        {
          conversationId: s.conversation.id,
          clientRequestId: 'req-tempo-frase',
          actorClerkUserId: s.caller.actorId!,
          actorDisplayName: 'Atendente',
        },
        s.clock,
        {
          mode: 'synthetic',
          adapter: new FixedOutputAdapter(reply(TEMPO_REFUSED_PHRASE)),
          forecast: reading('encoberto', 28),
        },
      )
      const clinic = shown.contextInspection.payload.clinic
      const times = clinic?.freeSlots.flatMap((day) => day.times) ?? []
      expect(times).not.toContain('15:00')
      expect(clinic?.tempoNote).toBe(TEMPO_REFUSED_PHRASE)
      const raw = JSON.stringify(shown.contextInspection.payload)
      expect(raw).not.toMatch(/tempo_ceu|tempoCeu|percentagem|weather_code|precipitation|ceu_limpo|open-meteo/i)
      expect(shown.suggestion.status).toBe('pending')
      expect(shown.suggestion.suggestedText).toBe(TEMPO_REFUSED_PHRASE)
      expect(s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments`)?.n).toBe(0)

      const percent = await suggestReplyOp(
        s.db,
        s.caller,
        {
          conversationId: s.conversation.id,
          clientRequestId: 'req-tempo-pct',
          actorClerkUserId: s.caller.actorId!,
          actorDisplayName: 'Atendente',
        },
        s.clock,
        {
          mode: 'synthetic',
          adapter: new FixedOutputAdapter(reply('Hoje há 40% de chuva às 15:00.')),
          forecast: reading('encoberto', 28),
        },
      )
      expect(percent.suggestion.status).toBe('failed')
      expect(percent.suggestion.suggestedText).toBe('')
      expect(percent.suggestion.warningCodes).toContain('output_rejected')

      const leaked = await suggestReplyOp(
        s.db,
        s.caller,
        {
          conversationId: s.conversation.id,
          clientRequestId: 'req-tempo-hora',
          actorClerkUserId: s.caller.actorId!,
          actorDisplayName: 'Atendente',
        },
        s.clock,
        {
          mode: 'synthetic',
          adapter: new FixedOutputAdapter(reply('Tenho hoje às 15:00 para o bronzeamento.')),
          forecast: reading('encoberto', 28),
        },
      )
      expect(leaked.suggestion.status).toBe('failed')
      expect(leaked.suggestion.suggestedText).toBe('')
      expect(s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments`)?.n).toBe(0)
    } finally {
      s.close()
    }
  })

  it('depilação em Tanto faz não acrescenta frase, mesmo sem leitura', async () => {
    const s = seed('Quero depilação hoje às 15h')
    try {
      const clinic = await buildClinicAiContext(s.db, s.tenantId, s.clock, {
        contactId: s.contact.id,
        recentTexts: ['Quero depilação hoje às 15h'],
        forecast: { async read() { return { ok: false as const } } },
      })
      expect(clinic.tempoNote).toBeNull()
      expect(JSON.stringify(clinic)).not.toContain(TEMPO_REFUSED_PHRASE)
      expect(JSON.stringify(clinic)).not.toContain(TEMPO_UNCONFIRMED_PHRASE)
      expect(s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments`)?.n).toBe(0)
    } finally {
      s.close()
    }
  })

  it('sem previsão a frase é a de não confirmar e 15h fica de fora', async () => {
    const s = seed('Quero bronzeamento hoje às 15h')
    try {
      const clinic = await buildClinicAiContext(s.db, s.tenantId, s.clock, {
        contactId: s.contact.id,
        recentTexts: ['Quero bronzeamento hoje às 15h'],
        forecast: { async read() { return { ok: false as const } } },
      })
      expect(clinic.tempoNote).toBe(TEMPO_UNCONFIRMED_PHRASE)
      expect(clinic.freeSlots.flatMap((day) => day.times)).not.toContain('15:00')
    } finally {
      s.close()
    }
  })
})
