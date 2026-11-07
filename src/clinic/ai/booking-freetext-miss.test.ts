/**
 * Texto livre no funil (staging 06/11/2026, dados fictícios).
 * Zona composta não parte no «e». «Sexta às 0900» escolhe 09:00
 * e não reabre a pergunta das zonas. O nome do serviço no meio da
 * frase sai em minúsculas; os rótulos das zonas ficam como no cadastro.
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter } from '../../ai'
import { createControllableClock } from '../../db/clock'
import { replaceServiceZonesOp, setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { readZoneSnapshots } from '../config/zones'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { localHHMM } from './slot-offer'
import { clinicCivilDateFromUtc } from '../scheduling/timezone'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'
import { getBookingFrame } from './schedule-session'
import {
  evaluateProposalAuthorization,
  getProposal,
  markProposalSent,
} from '../proposals/proposals'

/** 06/11/2026 07:30 America/Sao_Paulo — sexta, antes das 09:00. */
const NOW = Date.UTC(2026, 10, 6, 10, 30)

function seed() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-a'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_freetext',
      phoneNumberId: 'pn_freetext',
      wabaId: 'waba_freetext',
      displayPhone: '+5511900000077',
      displayName: 'Clínica Teste',
      action: 'channel_connected',
    },
    clock,
  )
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1', category: 'Sala' }, clock)
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi', homeRoomId: room.id }, clock)
  const svc = upsertServiceOp(
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
  replaceServiceZonesOp(
    db,
    caller,
    svc.id,
    [
      { name: 'Axila', durationMinutes: 15, priceCents: 4000, audience: 'feminino' },
      { name: 'Pernas', durationMinutes: 30, priceCents: 9000, audience: 'feminino' },
      { name: 'Axila', durationMinutes: 15, priceCents: 5000, audience: 'masculino' },
      { name: 'Pernas', durationMinutes: 30, priceCents: 11000, audience: 'masculino' },
      { name: 'Tórax e Abdômen', durationMinutes: 20, priceCents: 7000, audience: 'masculino' },
      { name: 'Costas', durationMinutes: 20, priceCents: 7000, audience: 'masculino' },
      { name: 'Braços', durationMinutes: 20, priceCents: 7000, audience: 'masculino' },
      { name: 'Intima', durationMinutes: 15, priceCents: 5000, audience: 'masculino' },
      { name: 'Orelha', durationMinutes: 10, priceCents: 3000, audience: 'masculino' },
    ],
    clock,
  )
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 9 * 60, endMinute: 18 * 60 }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000077', displayName: 'Carla Demo' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  return { ...boot, clock, tenantId, caller, cnv }
}

async function say(s: ReturnType<typeof seed>, body: string) {
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

/** Linha, masculina, zonas compostas e Sim — lista com 09:00 e 10:00. */
async function openFridaySlots(s: ReturnType<typeof seed>) {
  const line = await say(s, 'Quero agendar uma depilação')
  const lineText = line.autoBook?.replyText ?? ''
  expect(lineText).toMatch(/feminina ou masculina/i)
  expect(lineText).not.toMatch(/Para Depilação/)

  await say(s, 'Masculina')
  const zones = await say(s, 'Axilas pernas e tórax e abdômen')
  const echo = zones.autoBook?.replyText ?? ''
  expect(echo).toBe('Entendi: Axila, Pernas e Tórax e Abdômen. Certo?')
  expect(echo).not.toMatch(/Não encontrei/i)

  const offered = await say(s, 'Sim')
  const offer = offered.autoBook?.replyText ?? ''
  expect(offer).toMatch(/09:00/)
  expect(offer).toMatch(/10:00/)
  expect(offer).not.toMatch(/Não encontrei/i)
  return offered
}

function proposalCount(s: ReturnType<typeof seed>): number {
  return s.db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM appointment_proposals WHERE tenant_id = ?`,
    s.tenantId,
  )!.n
}

describe('texto livre: zona composta, 0900 e serviço em prosa', () => {
  it('«tórax e abdômen» fecha com Axila e Pernas; «Sexta às 0900» marca 09:00', async () => {
    const s = seed()
    try {
      await openFridaySlots(s)

      const picked = await say(s, 'Sexta às 0900')
      const reply = picked.autoBook?.replyText ?? ''
      expect(reply).not.toMatch(/Não encontrei/i)
      expect(reply).not.toMatch(/Tórax e Abdômen, Costas/)
      expect(picked.autoBook?.proposalId).toBeTruthy()
      expect(picked.autoBook?.time).toBe('09:00')
      const proposal = s.db.get<{ starts_at: number }>(
        `SELECT starts_at FROM appointment_proposals WHERE tenant_id = ? AND id = ?`,
        s.tenantId,
        picked.autoBook?.proposalId ?? '',
      )
      expect(clinicCivilDateFromUtc('America/Sao_Paulo', proposal!.starts_at)).toBe('2026-11-06')
      expect(localHHMM('America/Sao_Paulo', proposal!.starts_at)).toBe('09:00')
      const snaps = readZoneSnapshots(s.db, s.tenantId, 'proposal', picked.autoBook?.proposalId ?? '')
      expect(snaps.map((zone) => zone.name)).toEqual(['Axila', 'Pernas', 'Tórax e Abdômen'])
    } finally {
      s.close()
    }
  }, 30_000)

  it.each(['Sexta às 09:00 e cotovelo', 'Sexta às 10h e cotovelo'])(
    '«%s» com horário casado não propõe e pergunta a zona',
    async (text) => {
      const s = seed()
      try {
        await openFridaySlots(s)
        const picked = await say(s, text)
        const reply = picked.autoBook?.replyText ?? ''
        expect(reply).toMatch(/Não encontrei cotovelo nas opções/)
        expect(picked.autoBook?.proposalId).toBeFalsy()
        expect(proposalCount(s)).toBe(0)
        const frame = getBookingFrame(s.db, s.tenantId, s.cnv.id)
        expect(frame?.variantIds?.length).toBe(3)
      } finally {
        s.close()
      }
    },
    30_000,
  )

  it.each([
    'Pode ser às 10 então',
    'Sexta às 10, valeu',
    'Prefiro às 10',
    'Sexta 10hrs',
    'Lá pelas 10',
    'Por volta das 10',
    'O das 10',
  ])('«%s» mantém Axila, Pernas e Tórax e Abdômen e propõe 10:00', async (text) => {
    const s = seed()
    try {
      await openFridaySlots(s)
      const picked = await say(s, text)
      const reply = picked.autoBook?.replyText ?? ''
      expect(reply).not.toMatch(/Não encontrei/i)
      expect(picked.autoBook?.proposalId).toBeTruthy()
      expect(picked.autoBook?.time).toBe('10:00')
      const snaps = readZoneSnapshots(s.db, s.tenantId, 'proposal', picked.autoBook?.proposalId ?? '')
      expect(snaps.map((zone) => zone.name)).toEqual(['Axila', 'Pernas', 'Tórax e Abdômen'])
    } finally {
      s.close()
    }
  }, 30_000)

  it('«Na verdade, só pernas» entra no eco e não pergunta «verdade»', async () => {
    const s = seed()
    try {
      await openFridaySlots(s)
      const turned = await say(s, 'Na verdade, só pernas')
      const reply = turned.autoBook?.replyText ?? ''
      expect(reply).toBe('Entendi: Pernas. Certo?')
      expect(reply).not.toMatch(/Não encontrei/i)
      expect(turned.autoBook?.proposalId).toBeFalsy()
      expect(proposalCount(s)).toBe(0)
    } finally {
      s.close()
    }
  }, 30_000)

  it('D3: «não quero pernas, só axila» — pernas na negação não reentra', async () => {
    const s = seed()
    try {
      await openFridaySlots(s)
      const turned = await say(s, 'Na verdade não quero pernas, só axila')
      const reply = turned.autoBook?.replyText ?? ''
      expect(reply).toBe('Entendi: Axila. Certo?')
      expect(reply).not.toMatch(/Pernas/i)
      expect(reply).not.toMatch(/Não encontrei/i)
      expect(turned.autoBook?.proposalId).toBeFalsy()
    } finally {
      s.close()
    }
  }, 30_000)

  it('eco de substituição suspende o Confirmar; Corrigir devolve a mesma proposta', async () => {
    const s = seed()
    try {
      await openFridaySlots(s)
      const picked = await say(s, 'Às 10')
      const proposalId = picked.autoBook?.proposalId ?? ''
      expect(proposalId).toBeTruthy()
      markProposalSent(s.db, s.tenantId, proposalId, s.clock)
      const echoed = await say(s, 'Na verdade, só pernas')
      expect(echoed.autoBook?.replyText).toBe('Entendi: Pernas. Certo?')
      const suspended = getProposal(s.db, s.tenantId, proposalId)
      expect(suspended?.state).not.toBe('substituida')
      expect(suspended?.confirmSuspended).toBe(true)
      const denied = evaluateProposalAuthorization(
        s.db,
        {
          tenantId: s.tenantId,
          proposalId,
          contactId: suspended!.contactId,
          conversationId: s.cnv.id,
        },
        s.clock,
      )
      expect(denied.allowed).toBe(false)
      if (!denied.allowed) expect(denied.reason).toBe('confirm_suspended')

      const corrected = await say(s, 'Corrigir')
      expect(corrected.autoBook?.replyText ?? '').not.toMatch(/Entendi:/)
      const resumed = getProposal(s.db, s.tenantId, proposalId)
      expect(resumed?.id).toBe(proposalId)
      expect(resumed?.state).toBe('enviada')
      expect(resumed?.confirmSuspended).toBe(false)
      const allowed = evaluateProposalAuthorization(
        s.db,
        {
          tenantId: s.tenantId,
          proposalId,
          contactId: resumed!.contactId,
          conversationId: s.cnv.id,
        },
        s.clock,
      )
      expect(allowed.allowed).toBe(true)
      expect(appointmentCount(s)).toBe(0)
    } finally {
      s.close()
    }
  }, 30_000)

  it('Sim do eco não marca e a proposta nova substitui a suspensa', async () => {
    const s = seed()
    try {
      await openFridaySlots(s)
      const picked = await say(s, 'Às 10')
      const previousId = picked.autoBook?.proposalId ?? ''
      expect(previousId).toBeTruthy()
      const echoed = await say(s, 'só pernas')
      expect(echoed.autoBook?.replyText).toBe('Entendi: Pernas. Certo?')
      expect(getProposal(s.db, s.tenantId, previousId)?.confirmSuspended).toBe(true)
      const sim = await say(s, 'Sim')
      expect(sim.autoBook?.proposalId).toBeTruthy()
      expect(sim.autoBook?.proposalId).not.toBe(previousId)
      expect(getProposal(s.db, s.tenantId, previousId)?.state).toBe('substituida')
      const snaps = readZoneSnapshots(s.db, s.tenantId, 'proposal', sim.autoBook?.proposalId ?? '')
      expect(snaps.map((zone) => zone.name)).toEqual(['Pernas'])
      expect(appointmentCount(s)).toBe(0)
    } finally {
      s.close()
    }
  }, 30_000)

  it('partícula, hora e zona desconhecida não suspendem a proposta aberta', async () => {
    const s = seed()
    try {
      await openFridaySlots(s)
      const picked = await say(s, 'Às 10')
      const proposalId = picked.autoBook?.proposalId ?? ''
      const particle = await say(s, 'Pode ser às 10 então')
      expect(particle.autoBook?.replyText ?? '').not.toMatch(/Não encontrei/i)
      expect(getProposal(s.db, s.tenantId, proposalId)?.confirmSuspended).toBe(false)
      expect(getProposal(s.db, s.tenantId, proposalId)?.state).not.toBe('substituida')

      const unknown = await say(s, 'Sexta às 09:00 e cotovelo')
      expect(unknown.autoBook?.replyText ?? '').toMatch(/Não encontrei cotovelo/)
      expect(unknown.autoBook?.proposalId).toBeFalsy()
      const still = getProposal(s.db, s.tenantId, proposalId)
      expect(still?.confirmSuspended).toBe(false)
      expect(still?.state).not.toBe('substituida')
      const frame = getBookingFrame(s.db, s.tenantId, s.cnv.id)
      expect(frame?.variantIds?.length).toBe(3)
    } finally {
      s.close()
    }
  }, 30_000)

  it('«Pode ser às 18?» sem vaga deixa a proposta das 17:00 confirmável', async () => {
    const s = seed()
    try {
      const line = await say(s, 'Quero agendar uma depilação')
      expect(line.autoBook?.replyText ?? '').toMatch(/feminina ou masculina/i)
      await say(s, 'Feminina')
      const zones = await say(s, 'Axila e pernas')
      expect(zones.autoBook?.replyText).toBe('Entendi: Axila e Pernas. Certo?')
      await say(s, 'Sim')
      const picked = await say(s, 'sexta às 17:00')
      const proposalId = picked.autoBook?.proposalId ?? ''
      expect(proposalId).toBeTruthy()
      expect(picked.autoBook?.time).toBe('17:00')
      markProposalSent(s.db, s.tenantId, proposalId, s.clock)

      const asked = await say(s, 'Pode ser às 18?')
      const reply = asked.autoBook?.replyText ?? ''
      expect(reply).toMatch(/18:00/)
      expect(reply).toMatch(/vaga|ocupad/i)
      expect(asked.autoBook?.proposalId).toBeFalsy()
      expect(proposalCount(s)).toBe(1)
      const proposal = getProposal(s.db, s.tenantId, proposalId)
      expect(proposal?.state).toBe('enviada')
      expect(proposal?.confirmSuspended).toBe(false)
      expect(localHHMM('America/Sao_Paulo', proposal!.startsAt)).toBe('17:00')
      const frame = getBookingFrame(s.db, s.tenantId, s.cnv.id)
      expect(frame?.time).toBe('17:00')
      const auth = evaluateProposalAuthorization(
        s.db,
        {
          tenantId: s.tenantId,
          proposalId,
          contactId: proposal!.contactId,
          conversationId: s.cnv.id,
        },
        s.clock,
      )
      expect(auth.allowed).toBe(true)
      expect(appointmentCount(s)).toBe(0)
    } finally {
      s.close()
    }
  }, 30_000)
})

function appointmentCount(s: ReturnType<typeof seed>): number {
  return s.db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ?`,
    s.tenantId,
  )!.n
}
