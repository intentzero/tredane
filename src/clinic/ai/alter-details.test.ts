/**
 * Alterar detalhes → menu IA (Paulo 09/11/2026).
 * Sem handoff; Horário reoferta slots; Confirmar na proposta invalidada falha.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import {
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
import {
  createProposal,
  evaluateProposalAuthorization,
  getProposal,
  handleProposalButtonClick,
  markProposalSent,
  proposalButtonId,
  renderProposalInteractive,
} from '../proposals'
import { zonedCivilToUtc } from '../scheduling/timezone'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel, touchWhatsappLastInbound } from '../whatsapp/channel'
import {
  ALTER_DETAILS_MENU_BODY,
  ALTER_HORARIO_KEY,
  ALTER_SERVICO_KEY,
  ALTER_VARIANTES_KEY,
  beginAlterDetailsMenu,
  buildAlterDetailsMenu,
  handleAlterDetailsChoice,
  serviceOffersVariantBranch,
} from './alter-details'
import { encodeChoiceId, handleChoiceOfferClick } from './choice-offer'
import { HUMAN_HANDOFF_TEXT, readAiReplyPause } from './human-handoff'
import { getBookingFrame, saveBookingFrame } from './schedule-session'
import { readCatalogVersion } from './turn-context'

const TZ = 'America/Sao_Paulo'
const NOW = Date.UTC(2026, 9, 28, 18, 51)

function seed(opts?: { withZones?: boolean }) {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-alter'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_alter',
      phoneNumberId: 'pn_alter',
      wabaId: 'waba_alter',
      displayPhone: '+5511900000099',
      displayName: 'Clínica Alter',
      action: 'channel_connected',
    },
    clock,
  )
  const gi = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi' }, clock)
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação',
      durationMinutes: 15,
      bufferMinutes: 15,
      priceCents: 5000,
      professionalIds: [gi.id],
      roomRequirement: { mode: 'none' },
      ...(opts?.withZones !== false
        ? { variantKind: 'zona', variantKindPlural: 'zonas' }
        : {}),
    },
    clock,
  )
  if (opts?.withZones !== false) {
    replaceServiceZonesOp(
      db,
      caller,
      svc.id,
      [
        {
          name: 'Axila',
          audience: 'feminino',
          durationMinutes: 15,
          priceCents: 4000,
        },
        {
          name: 'Pernas',
          audience: 'feminino',
          durationMinutes: 30,
          priceCents: 8000,
        },
      ],
      clock,
    )
  }
  const split = [1, 2, 3, 4, 5].flatMap((d) => [
    { dayOfWeek: d, startMinute: 9 * 60, endMinute: 12 * 60 },
    { dayOfWeek: d, startMinute: 13 * 60, endMinute: 18 * 60 },
  ])
  setWeeklyWindowsOp(db, caller, { resourceId: gi.id, windows: split }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000088', displayName: 'Paulo' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  // Janela 24 h aberta para interactive (menu Alterar / ofertas).
  touchWhatsappLastInbound(db, tenantId, clock.nowMs())
  insertMessage(
    db,
    {
      tenantId,
      conversationId: cnv.id,
      direction: 'inbound',
      body: 'Oi',
      deliveryState: 'received',
      createdAt: clock.nowMs() - 1_000,
    },
    clock,
  )
  const zoneIds = db
    .all<{ id: string }>(
      `SELECT id FROM service_zones WHERE tenant_id = ? AND service_id = ? AND active = 1`,
      tenantId,
      svc.id,
    )
    .map((z) => z.id)
  return {
    db,
    clock,
    tenantId,
    caller,
    contact,
    cnv,
    svc,
    gi,
    zoneIds,
    close: () => boot.close(),
  }
}

describe('Alterar detalhes → menu IA', () => {
  it('menu inclui Detalhes do serviço quando o serviço tem zonas', () => {
    const s = seed({ withZones: true })
    try {
      expect(serviceOffersVariantBranch(s.svc.id, s.db, s.tenantId)).toBe(true)
      const menu = buildAlterDetailsMenu({
        catalogVersion: 'v1',
        includeVariants: true,
      })
      expect(menu.body).toBe(ALTER_DETAILS_MENU_BODY)
      expect(menu.interactive.buttons.map((b) => b.title)).toEqual([
        'Horário',
        'Serviço',
        'Detalhes do serviço',
      ])
      expect(menu.pending.options.map((o) => o.key)).toEqual([
        ALTER_HORARIO_KEY,
        ALTER_SERVICO_KEY,
        ALTER_VARIANTES_KEY,
      ])
    } finally {
      s.close()
    }
  })

  it('menu omite Detalhes do serviço sem zonas', () => {
    const s = seed({ withZones: false })
    try {
      expect(serviceOffersVariantBranch(s.svc.id, s.db, s.tenantId)).toBe(false)
      const menu = buildAlterDetailsMenu({
        catalogVersion: 'v1',
        includeVariants: false,
      })
      expect(menu.interactive.buttons.map((b) => b.title)).toEqual(['Horário', 'Serviço'])
    } finally {
      s.close()
    }
  })

  it('clique Alterar invalida sem handoff e abre o menu', () => {
    const s = seed()
    try {
      const startsAt = zonedCivilToUtc(TZ, 2026, 10, 29, 15, 0)
      const proposal = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          serviceId: s.svc.id,
          professionalId: s.gi.id,
          startsAt,
          zoneIds: s.zoneIds,
        },
        s.clock,
      )
      markProposalSent(s.db, s.tenantId, proposal.id, s.clock)
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.svc.id,
          line: 'feminino',
          variantIds: s.db
            .all<{ zone_id: string }>(
              `SELECT zone_id FROM visit_zone_snapshots WHERE tenant_id = ? AND owner_kind = 'proposal' AND owner_id = ?`,
              s.tenantId,
              proposal.id,
            )
            .map((r) => r.zone_id),
          date: '2026-10-29',
          time: '15:00',
          proposal: { id: proposal.id, version: proposal.version },
          phase: 'proposto',
        },
        s.clock,
      )

      const click = handleProposalButtonClick(
        s.db,
        {
          tenantId: s.tenantId,
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          buttonId: proposalButtonId(proposal.id, proposal.version, 'alter'),
          buttonTitle: 'Alterar detalhes',
        },
        s.clock,
      )
      expect(click.handled).toBe(true)
      if (!('action' in click) || click.action !== 'alter' || !('reoffer' in click)) {
        throw new Error('expected alter reoffer')
      }
      expect(click.reoffer).toBe(true)
      expect(click.cancelledExistingAppointment).toBe(false)
      expect(click.outbox.some((row) => row.type === 'whatsapp.send')).toBe(false)
      expect(getProposal(s.db, s.tenantId, proposal.id)?.state).toBe('substituida')
      expect(readAiReplyPause(s.db, s.tenantId, s.cnv.id)).toBeNull()

      const menu = beginAlterDetailsMenu(s.db, s.caller, s.cnv.id, s.clock, {
        proposal: getProposal(s.db, s.tenantId, proposal.id)!,
      })
      expect(menu.includeVariants).toBe(true)
      expect(menu.outbox.some((row) => row.type === 'whatsapp.send')).toBe(true)
      const sent = s.db.get<{ body: string; interactive_json: string | null }>(
        `SELECT m.body AS body, o.interactive_json AS interactive_json
         FROM messages m
         LEFT JOIN outbound_messages o ON o.message_id = m.id AND o.tenant_id = m.tenant_id
         WHERE m.tenant_id = ? AND m.direction = 'outbound'
         ORDER BY m.created_at DESC LIMIT 1`,
        s.tenantId,
      )
      expect(sent?.body).toBe(ALTER_DETAILS_MENU_BODY)
      expect(sent?.body).not.toBe(HUMAN_HANDOFF_TEXT)
      expect(sent?.interactive_json ?? '').toContain('"title":"Horário"')
      expect(sent?.interactive_json ?? '').toContain('"title":"Serviço"')
      expect(sent?.interactive_json ?? '').toContain('"title":"Detalhes do serviço"')
      // Chave opaca `~variantes` no id é interna; INV-05 olha títulos/corpo.
      const titles = JSON.parse(sent?.interactive_json ?? '{}').buttons?.map(
        (b: { title: string }) => b.title,
      ) as string[]
      expect(titles.join(' ')).not.toMatch(/\bvariant(?:e|es)\b/i)
      expect(sent?.body).not.toMatch(/\bvariant(?:e|es)\b/i)
      expect(getBookingFrame(s.db, s.tenantId, s.cnv.id)?.pending?.slot).toBe('alter')

      const auth = evaluateProposalAuthorization(
        s.db,
        {
          tenantId: s.tenantId,
          proposalId: proposal.id,
          contactId: s.contact.id,
          conversationId: s.cnv.id,
        },
        s.clock,
      )
      expect(auth.allowed).toBe(false)
    } finally {
      s.close()
    }
  })

  it('ramo Horário reoferta slots e mantém o serviço', async () => {
    const s = seed()
    try {
      const startsAt = zonedCivilToUtc(TZ, 2026, 10, 29, 15, 0)
      const proposal = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          serviceId: s.svc.id,
          professionalId: s.gi.id,
          startsAt,
          zoneIds: s.zoneIds,
        },
        s.clock,
      )
      markProposalSent(s.db, s.tenantId, proposal.id, s.clock)
      // Invalida + menu
      handleProposalButtonClick(
        s.db,
        {
          tenantId: s.tenantId,
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          buttonId: proposalButtonId(proposal.id, proposal.version, 'alter'),
        },
        s.clock,
      )
      beginAlterDetailsMenu(s.db, s.caller, s.cnv.id, s.clock, {
        proposal: getProposal(s.db, s.tenantId, proposal.id)!,
      })
      insertMessage(
        s.db,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          direction: 'inbound',
          body: '[Botão] Horário',
          deliveryState: 'received',
          createdAt: s.clock.nowMs(),
        },
        s.clock,
      )
      s.clock.advance(1)

      const catalogVersion = readCatalogVersion(s.db, s.tenantId)
      const choice = await handleChoiceOfferClick(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          buttonId: encodeChoiceId('alter', catalogVersion, ALTER_HORARIO_KEY),
          capability: true,
        },
        s.clock,
      )
      expect(choice.handled).toBe(true)
      if (!choice.handled) throw new Error('expected handled')
      expect(choice.outcome).toBe('applied')
      const frame = getBookingFrame(s.db, s.tenantId, s.cnv.id)
      expect(frame?.serviceId).toBe(s.svc.id)
      expect(frame?.date).toBeNull()
      expect(frame?.time).toBeNull()
      expect(readAiReplyPause(s.db, s.tenantId, s.cnv.id)).toBeNull()
      const outbound = s.db.all<{ body: string; interactive_json: string | null }>(
        `SELECT m.body AS body, o.interactive_json AS interactive_json
         FROM messages m
         LEFT JOIN outbound_messages o ON o.message_id = m.id AND o.tenant_id = m.tenant_id
         WHERE m.tenant_id = ? AND m.direction = 'outbound'
         ORDER BY m.created_at`,
        s.tenantId,
      )
      const last = outbound[outbound.length - 1]
      expect(last?.body).not.toBe(HUMAN_HANDOFF_TEXT)
      // Oferta de horários ou T1 Manhã|Tarde|Outro dia
      const interactive = last?.interactive_json ?? ''
      const hasSlots =
        /\d{1,2}:\d{2}/.test(last?.body ?? '') ||
        interactive.includes('Horários') ||
        interactive.includes('Manhã')
      expect(hasSlots).toBe(true)
    } finally {
      s.close()
    }
  })

  it('ramo Serviço abre catálogo DEC-142', async () => {
    const s = seed()
    try {
      const startsAt = zonedCivilToUtc(TZ, 2026, 10, 29, 15, 0)
      const proposal = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          serviceId: s.svc.id,
          professionalId: s.gi.id,
          startsAt,
          zoneIds: s.zoneIds,
        },
        s.clock,
      )
      markProposalSent(s.db, s.tenantId, proposal.id, s.clock)
      handleProposalButtonClick(
        s.db,
        {
          tenantId: s.tenantId,
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          buttonId: proposalButtonId(proposal.id, proposal.version, 'alter'),
        },
        s.clock,
      )
      beginAlterDetailsMenu(s.db, s.caller, s.cnv.id, s.clock, {
        proposal: getProposal(s.db, s.tenantId, proposal.id)!,
      })
      s.clock.advance(1_000)
      const branch = await handleAlterDetailsChoice(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.cnv.id,
          key: ALTER_SERVICO_KEY,
          capability: true,
        },
        s.clock,
      )
      expect(branch.branch).toBe(ALTER_SERVICO_KEY)
      expect(branch.outbox.some((row) => row.type === 'whatsapp.send')).toBe(true)
      const frame = getBookingFrame(s.db, s.tenantId, s.cnv.id)
      expect(frame?.serviceId).toBeNull()
      const sent = s.db.get<{ body: string; interactive_json: string | null }>(
        `SELECT m.body AS body, o.interactive_json AS interactive_json
         FROM messages m
         LEFT JOIN outbound_messages o ON o.message_id = m.id AND o.tenant_id = m.tenant_id
         WHERE m.tenant_id = ? AND m.direction = 'outbound'
         ORDER BY m.created_at DESC, m.id DESC LIMIT 1`,
        s.tenantId,
      )
      expect(sent?.body).toMatch(/Feminino ou masculino|Temos:/i)
    } finally {
      s.close()
    }
  })

  it('copy da proposta não manda Alterar para a equipe', () => {
    const s = seed()
    try {
      const startsAt = zonedCivilToUtc(TZ, 2026, 10, 29, 15, 0)
      const proposal = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contact.id,
          conversationId: s.cnv.id,
          serviceId: s.svc.id,
          professionalId: s.gi.id,
          startsAt,
          zoneIds: s.zoneIds,
        },
        s.clock,
      )
      const rendered = renderProposalInteractive(proposal, s.db)
      expect(rendered.body).toMatch(
        /Alterar detalhes para mudar horário, serviço ou detalhes/,
      )
      expect(rendered.body).not.toMatch(/\bvariant(?:e|es)\b/i)
      expect(rendered.body).not.toMatch(/Alterar detalhes para mudar ou em Falar/)
    } finally {
      s.close()
    }
  })
})
