/**
 * DEC-077 / S5 — filtro automático e clique. A grade da equipe não esconde a hora.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { tryAiAutoBook } from '../ai/autobook'
import { formatClinicTime } from '../ai/schedule-context'
import {
  setForecastPlaceOp,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import { upsertContact } from '../contacts'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { clinicInbox, clinicWhatsapp, workerCaller } from '../index'
import {
  createProposal,
  executeProposalConfirmOp,
  handleProposalButtonClick,
  markProposalSent,
  proposalButtonId,
} from '../proposals'
import { queryAvailabilityOp } from '../scheduling'
import { bootClinicDb } from '../test-db'
import { queryAutomaticAvailability } from './automatic'
import type { ForecastAdapter, SkySymbol } from './evaluate'

const DAY = '2024-01-08'
const CLOCK = Date.UTC(2024, 0, 8, 11, 0)

function reading(sky: SkySymbol, celsius: number): ForecastAdapter & { calls: number } {
  const adapter = {
    calls: 0,
    async read() {
      adapter.calls += 1
      return { ok: true as const, sky, celsius }
    },
  }
  return adapter
}

function seedList() {
  const clock = createControllableClock(CLOCK)
  const boot = bootClinicDb({ clock })
  const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
  const pro = upsertResourceOp(boot.db, caller, { kind: 'professional', name: 'Gi' }, clock)
  setWeeklyWindowsOp(
    boot.db,
    caller,
    { resourceId: pro.id, windows: [{ dayOfWeek: 1, startMinute: 8 * 60, endMinute: 18 * 60 }] },
    clock,
  )
  const make = (
    name: string,
    tempo: { tempoCeu?: 'sol' | 'chuva'; tempoTemperatura?: 'acima'; tempoCelsius?: number } = {},
  ) => upsertServiceOp(
    boot.db,
    caller,
    {
      name,
      durationMinutes: 60,
      bufferMinutes: 0,
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
      ...tempo,
    },
    clock,
  )
  return { ...boot, clock, caller, bronze: make('Bronzeamento', { tempoCeu: 'sol', tempoTemperatura: 'acima', tempoCelsius: 24 }), dep: make('Depilação') }
}

function at15(slots: { startsAt: number }[]): boolean {
  return slots.some((slot) => formatClinicTime('America/Sao_Paulo', slot.startsAt) === '15:00')
}

describe('filtro automático do bloco Tempo (S5)', () => {
  it('15h entra com céu limpo e 25 °C e sai com 22 °C ou encoberto; a equipe continua a ver', async () => {
    const s = seedList()
    try {
      setForecastPlaceOp(s.db, s.caller, { mode: 'cidade', city: 'Campinas' }, s.clock)
      const team = queryAvailabilityOp(s.db, s.caller, { serviceId: s.bronze.id, date: DAY, tempoMode: 'equipe' }, s.clock)
      expect(at15(team.slots)).toBe(true)

      const hot = reading('ceu_limpo', 25)
      const good = await queryAutomaticAvailability(
        s.db,
        s.caller.tenantId,
        { serviceId: s.bronze.id, date: DAY },
        s.clock,
        hot,
      )
      expect(at15(good.slots)).toBe(true)

      const cold = await queryAutomaticAvailability(
        s.db,
        s.caller.tenantId,
        { serviceId: s.bronze.id, date: DAY },
        s.clock,
        reading('ceu_limpo', 22),
      )
      expect(at15(cold.slots)).toBe(false)

      const cloud = await queryAutomaticAvailability(
        s.db,
        s.caller.tenantId,
        { serviceId: s.bronze.id, date: DAY },
        s.clock,
        reading('encoberto', 28),
      )
      expect(at15(cloud.slots)).toBe(false)
      expect(at15(queryAvailabilityOp(s.db, s.caller, { serviceId: s.bronze.id, date: DAY }, s.clock).slots)).toBe(true)
    } finally {
      s.close()
    }
  })

  it('depilação sem local oferece; bronzeamento com Sol e sem local não oferece no automático', async () => {
    const s = seedList()
    try {
      const boom: ForecastAdapter = { async read() { throw new Error('rede') } }
      const dep = await queryAutomaticAvailability(
        s.db,
        s.caller.tenantId,
        { serviceId: s.dep.id, date: DAY },
        s.clock,
        boom,
      )
      expect(at15(dep.slots)).toBe(true)
      const bronze = await queryAutomaticAvailability(
        s.db,
        s.caller.tenantId,
        { serviceId: s.bronze.id, date: DAY },
        s.clock,
        boom,
      )
      expect(bronze.slots).toEqual([])
    } finally {
      s.close()
    }
  })

  it('não nasce proposta para as 15h quando o tempo não serve', async () => {
    const s = seedList()
    try {
      setForecastPlaceOp(s.db, s.caller, { mode: 'cidade', city: 'Campinas' }, s.clock)
      const contact = upsertContact(s.db, { tenantId: s.caller.tenantId, waId: '5511999000015', displayName: 'Ana' }, s.clock)
      const conversation = createConversation(s.db, { tenantId: s.caller.tenantId, contactId: contact.id, status: 'open' }, s.clock)
      insertMessage(
        s.db,
        {
          tenantId: s.caller.tenantId,
          conversationId: conversation.id,
          direction: 'inbound',
          body: 'Quero Bronzeamento hoje às 15h',
          externalMessageId: 'wamid.tempo_s5',
          deliveryState: 'received',
          authorClerkUserId: null,
          authorDisplayName: null,
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      const out = await tryAiAutoBook(s.db, s.caller, s.clock, {
        conversationId: conversation.id,
        capability: true,
        forecast: reading('encoberto', 30),
      })
      expect(out.proposalId).toBeUndefined()
      expect(s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointment_proposals`)?.n).toBe(0)
    } finally {
      s.close()
    }
  })
})

function seedClick() {
  const clock = createControllableClock(CLOCK)
  const boot = bootClinicDb({ clock })
  const tenantId = 'clinic-demo-a'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  clinicWhatsapp.syncWhatsappChannel(
    boot.db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_s5t',
      phoneNumberId: 'pn_s5t',
      wabaId: 'waba_s5t',
      displayPhone: '+5511999000000',
      displayName: 'Clínica Tempo',
      action: 'channel_connected',
    },
    clock,
  )
  clinicInbox.seedSyntheticWhatsappTemplates(boot.db, tenantId, clock)
  const pro = upsertResourceOp(boot.db, caller, { kind: 'professional', name: 'Gi' }, clock)
  setWeeklyWindowsOp(
    boot.db,
    caller,
    { resourceId: pro.id, windows: [{ dayOfWeek: 1, startMinute: 8 * 60, endMinute: 18 * 60 }] },
    clock,
  )
  const service = upsertServiceOp(
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
  setForecastPlaceOp(boot.db, caller, { mode: 'cidade', city: 'Campinas' }, clock)
  const contact = upsertContact(boot.db, { tenantId, waId: '5511999000015', displayName: 'Ana' }, clock)
  const conversation = createConversation(boot.db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  insertMessage(
    boot.db,
    {
      tenantId,
      conversationId: conversation.id,
      direction: 'inbound',
      body: 'Oi',
      externalMessageId: 'wamid.in_tempo',
      deliveryState: 'received',
      authorClerkUserId: null,
      authorDisplayName: null,
      createdAt: clock.nowMs(),
    },
    clock,
  )
  const startsAt = queryAvailabilityOp(
    boot.db,
    caller,
    { serviceId: service.id, date: DAY, professionalId: pro.id },
    clock,
  ).slots.find((slot) => formatClinicTime('America/Sao_Paulo', slot.startsAt) === '15:00')!.startsAt
  const proposal = markProposalSent(
    boot.db,
    tenantId,
    createProposal(
      boot.db,
      tenantId,
      { contactId: contact.id, conversationId: conversation.id, serviceId: service.id, professionalId: pro.id, startsAt },
      clock,
    ).id,
    clock,
  )
  boot.db.run(
    `UPDATE appointment_proposals SET send_provider_message_id = ? WHERE tenant_id = ? AND id = ?`,
    'wamid.proposal_tempo',
    tenantId,
    proposal.id,
  )
  return { ...boot, clock, caller, tenantId, pro, service, contact, conversation, proposal, startsAt }
}

async function click(
  s: ReturnType<typeof seedClick>,
  forecast: ForecastAdapter,
) {
  const handoff = handleProposalButtonClick(
    s.db,
    {
      tenantId: s.tenantId,
      contactId: s.contact.id,
      conversationId: s.conversation.id,
      buttonId: proposalButtonId(s.proposal.id, s.proposal.version, 'confirm'),
      contextMessageId: 'wamid.proposal_tempo',
      providerEventKey: 'evt_tempo',
    },
    s.clock,
  )
  if (!('handoff' in handoff)) throw new Error('expected handoff')
  return executeProposalConfirmOp(
    s.db,
    s.caller,
    {
      handoff: handoff.handoff,
      capability: true,
      providerEventKey: 'evt_tempo',
      contextMessageId: 'wamid.proposal_tempo',
      senderContactId: s.contact.id,
    },
    s.clock,
    { forecast },
  )
}

function bodies(db: ReturnType<typeof seedClick>['db'], tenantId: string): string[] {
  return db.all<{ body: string }>(`SELECT body FROM messages WHERE tenant_id = ?`, tenantId).map((row) => row.body)
}

describe('clique do bloco Tempo (S5)', () => {
  it('não serve e não confirma, mesmo sem sala, e não usa a frase de vaga', async () => {
    const s = seedClick()
    try {
      const result = await click(s, reading('encoberto', 30))
      expect(result.status).toBe('tempo_refused')
      if (result.status !== 'tempo_refused') return
      expect(result.proposal.state).toBe('recusada_tempo')
      expect(result.proposal.state).not.toBe('recusada_vaga')
      expect(s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments`)?.n).toBe(0)
      expect(s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM pix_charges WHERE tenant_id = ?`, s.tenantId)?.n).toBe(0)
      const text = bodies(s.db, s.tenantId).join('\n')
      expect(text).toContain('Nesse horário o tempo não serve para este serviço. A equipe envia outra opção em breve.')
      expect(text).not.toMatch(/percentagem|já não está livre|vaga/)
    } finally {
      s.close()
    }
  })

  it('previsão ilegível usa a frase de não confirmar e não cobra sinal', async () => {
    const s = seedClick()
    try {
      const signal = upsertServiceOp(
        s.db,
        s.caller,
        {
          id: s.service.id,
          name: 'Bronzeamento',
          durationMinutes: 60,
          bufferMinutes: 0,
          professionalIds: [s.pro.id],
          roomRequirement: { mode: 'none' },
          tempoCeu: 'sol',
          tempoTemperatura: 'acima',
          tempoCelsius: 24,
          requiresSignal: true,
          signalKind: 'fixed',
          signalFixedCents: 2000,
        },
        s.clock,
      )
      expect(signal.requiresSignal).toBe(true)
      const fresh = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.conversation.id,
          serviceId: s.service.id,
          professionalId: s.pro.id,
          startsAt: s.startsAt,
        },
        s.clock,
      )
      const sent = markProposalSent(s.db, s.tenantId, fresh.id, s.clock)
      s.db.run(
        `UPDATE appointment_proposals SET send_provider_message_id = ? WHERE id = ?`,
        'wamid.proposal_tempo2',
        sent.id,
      )
      const handoff = handleProposalButtonClick(
        s.db,
        {
          tenantId: s.tenantId,
          contactId: s.contact.id,
          conversationId: s.conversation.id,
          buttonId: proposalButtonId(sent.id, sent.version, 'confirm'),
          contextMessageId: 'wamid.proposal_tempo2',
          providerEventKey: 'evt_tempo2',
        },
        s.clock,
      )
      if (!('handoff' in handoff)) throw new Error('expected handoff')
      const result = await executeProposalConfirmOp(
        s.db,
        s.caller,
        {
          handoff: handoff.handoff,
          capability: true,
          contextMessageId: 'wamid.proposal_tempo2',
          providerEventKey: 'evt_tempo2',
        },
        s.clock,
        { forecast: { async read() { return { ok: false } } } },
      )
      expect(result.status).toBe('tempo_refused')
      const text = bodies(s.db, s.tenantId).join('\n')
      expect(text).toContain('Não deu para confirmar o tempo nesse horário. A equipe envia outra opção em breve.')
      expect(s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM pix_charges`)?.n).toBe(0)
      expect(s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments`)?.n).toBe(0)
    } finally {
      s.close()
    }
  })

  it('mudar Sol para Chuva encaminha e não responde com horário ocupado', async () => {
    const s = seedClick()
    try {
      const calls = reading('chuva', 18)
      upsertServiceOp(
        s.db,
        s.caller,
        {
          id: s.service.id,
          name: 'Bronzeamento',
          durationMinutes: 60,
          bufferMinutes: 0,
          professionalIds: [s.pro.id],
          roomRequirement: { mode: 'none' },
          tempoCeu: 'chuva',
          tempoTemperatura: 'tanto_faz',
        },
        s.clock,
      )
      const result = await click(s, calls)
      expect(result.status).toBe('denied')
      if (result.status !== 'denied') return
      expect(result.reason).toBe('material_changed')
      expect(result.proposal?.state).toBe('encaminhada')
      expect(calls.calls).toBe(0)
      const text = bodies(s.db, s.tenantId).join('\n')
      expect(text).not.toContain('Horário já não está livre')
      expect(s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments`)?.n).toBe(0)
    } finally {
      s.close()
    }
  })
})
