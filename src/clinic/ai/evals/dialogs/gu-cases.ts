/**
 * Família GU- (DEC-202): o chat não marca, não remarca e não cancela.
 * Pedido de marcar, remarcar, cancelar ou de vaga recebe uma frase fixa e o botão «Abrir agenda»
 * com o propósito certo; a IA só informa. Com a pausa da owner, passa à equipe.
 *
 * CW-12: efeito no chat depois do cancelamento **na página** (recibo único + DEC-086).
 * CW-13: serviço sem profissional — a página e a proposta recusam marcar (Conferir / DEC-085).
 * CW-14: Agendado page-booked com CTA «Abrir mapa» (DEC-211 opção B; sem URL Local no corpo).
 * CW-15: preferência / Sem preferência — filtra horas e rodízio por serviço (DEC-218).
 * GU-23: «Posso ajudar…» com cta_url Abrir agenda (sem reply que reenvia a frase).
 * GU-24–26: ver/listar agendamentos e cancelar fora do expediente → link (TRE-74).
 */
import { listServices, upsertServiceOp } from '../../../config'
import { ValidationError } from '../../../errors'
import { workerCaller } from '../../../envelopes'
import { POST_BOOKING_BODY, sendPostBookingFollowupOp } from '../../../followup/post-booking'
import { createOrSupersedeProposal } from '../../../proposals/proposals'
import { queryAvailability, zonedCivilToUtc } from '../../../scheduling'
import {
  appendWebCancelChatEffects,
  cancelFromWeb,
  WEB_CANCEL_ACTOR,
  WEB_CANCEL_RECEIPT_SENTENCE,
} from '../../../../clientweb/manage'
import { CLIENT_WEB_CTA_TEXT, OPEN_AGENDA_REPLY_BUTTON_ID } from '../../../../clientweb/offer'
import { listClientWebSlots, planWebProposal, readClientWebCatalog } from '../../../../clientweb/booking'
import { readRrLastProfessional } from '../../../../clientweb/round-robin'
import { OPEN_MAP_CTA_TEXT } from '../../location-map-offer'
import { HUMAN_HANDOFF_BUTTON_ID, HUMAN_HANDOFF_BUTTON_TITLE } from '../../human-handoff'
import {
  createProposal,
  markProposalConfirmed,
  markProposalSent,
  sendProposalResultMessageOp,
  WEB_RECEIPT_SENTENCE,
} from '../../../proposals'
import type { DialogCase } from './runner'
import type { DialogScenario } from './scenario'

export const GU_TZ = 'America/Sao_Paulo'

/** Marcação futura confirmada do contacto da conversa. */
export function seedFutureAppointment(
  s: DialogScenario,
  opts: { serviceId: string; professionalId: string; startsAt: number; id: string },
): void {
  const endsAt = opts.startsAt + 60 * 60_000
  s.db.run(
    `INSERT INTO appointments (id, tenant_id, service_id, professional_id, starts_at, ends_at, status, created_at, contact_id, confirmed_by)
     VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, 'system:proposal-send')`,
    opts.id,
    s.tenantId,
    opts.serviceId,
    opts.professionalId,
    opts.startsAt,
    endsAt,
    s.clock.nowMs() - 60_000,
    s.contactId,
  )
}

const withOneAppointment = (s: DialogScenario) =>
  seedFutureAppointment(s, {
    id: 'apt_gu_1',
    serviceId: s.ids.peeling,
    professionalId: s.ids.bia,
    startsAt: zonedCivilToUtc(GU_TZ, 2026, 11, 25, 10, 0),
  })

const withTwoAppointments = (s: DialogScenario) => {
  withOneAppointment(s)
  seedFutureAppointment(s, {
    id: 'apt_gu_2',
    serviceId: s.ids.massagem,
    professionalId: s.ids.ana,
    startsAt: zonedCivilToUtc(GU_TZ, 2026, 11, 27, 15, 0),
  })
}

/** Nada marca, nem proposta nem compromisso novo, e nenhuma hora vai no chat. */
const NEVER_BOOKS = { proposal: false, noAppointment: false } as const

export const GU_DIALOG_CASES: DialogCase[] = [
  {
    id: 'GU-01',
    title: 'Pedido completo com serviço nomeado: o link abre nesse serviço',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Quero marcar massagem relaxante amanhã às 10h' }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 0,
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'agendar', serviceId: 'Massagem relaxante' }],
      outboundIncludes: ['Abrir agenda'],
      outboundExcludes: [/\b\d{2}:\d{2}\b/],
    },
  },
  {
    id: 'GU-02',
    title: '«Quero marcar» sem serviço: o link abre na escolha de serviço',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Quero marcar' }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 0,
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'agendar', serviceId: null }],
    },
  },
  {
    id: 'GU-03',
    title: 'Cumprimento: abertura com o expediente e o link',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Oi' }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 0,
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'home' }],
      outboundIncludes: ['Olá!', 'Abrir agenda'],
    },
  },
  {
    id: 'GU-04',
    title: 'Pergunta por vaga: o chat não oferece horas, manda o link',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Tem horário amanhã de manhã?' }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 0,
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'agendar', serviceId: null }],
      outboundExcludes: [/\b\d{2}:\d{2}\b/],
    },
  },
  {
    id: 'GU-05',
    title: 'Zona nomeada reconhece o serviço',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Quero marcar axilas' }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 0,
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'agendar', serviceId: 'Depilação' }],
    },
  },
  {
    id: 'GU-06',
    title: 'Dois serviços no pedido: o link abre sem serviço pré-escolhido',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Quero marcar peeling químico e bronzeamento' }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 0,
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'agendar', serviceId: null }],
    },
  },
  {
    id: 'GU-07',
    title: 'Remarcar com uma marcação futura: o link abre nela',
    turnosIdeais: 1,
    prepare: withOneAppointment,
    turns: [{ role: 'client', text: 'Quero remarcar' }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 1,
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'remarcar', appointmentId: 'apt_gu_1' }],
      outboundIncludes: ['Para remarcar'],
    },
  },
  {
    id: 'GU-08',
    title: 'Cancelar com uma marcação futura: o link abre nela e o chat não cancela',
    turnosIdeais: 1,
    prepare: withOneAppointment,
    turns: [{ role: 'client', text: 'Preciso cancelar minha marcação' }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 1,
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'cancelar', appointmentId: 'apt_gu_1' }],
      outboundIncludes: ['Para cancelar'],
    },
  },
  {
    id: 'GU-09',
    title: 'Cancelar com duas marcações: o link abre a lista, sem alvo',
    turnosIdeais: 1,
    prepare: withTwoAppointments,
    turns: [{ role: 'client', text: 'Quero cancelar' }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 2,
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'cancelar', appointmentId: null }],
    },
  },
  {
    id: 'GU-10',
    title: 'Cancelar sem marcação futura: diz que não encontrou e abre em agendar',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Quero cancelar minha consulta' }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 0,
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'agendar', serviceId: null }],
      outboundIncludes: ['Não encontrei marcações'],
    },
  },
  {
    id: 'GU-11',
    title: 'Remarcar sem marcação futura: mesma resposta',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Preciso remarcar para sexta' }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 0,
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'agendar', serviceId: null }],
      outboundIncludes: ['Não encontrei marcações'],
    },
  },
  {
    id: 'GU-12',
    title: 'Pausa da owner: «quero marcar» passa à equipe, sem link',
    turnosIdeais: 1,
    ownerPaused: true,
    turns: [{ role: 'client', text: 'Quero marcar massagem amanhã' }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 0,
      noCtaUrl: true,
      paused: true,
      teamAlert: true,
    },
  },
  {
    id: 'GU-13',
    title: 'Pausa da owner: remarcar e cancelar também passam à equipe',
    turnosIdeais: 1,
    ownerPaused: true,
    prepare: withOneAppointment,
    turns: [{ role: 'client', text: 'Quero cancelar' }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 1,
      noCtaUrl: true,
      paused: true,
      teamAlert: true,
    },
  },
  {
    id: 'GU-14',
    title: 'Pausa da owner: o cumprimento responde sem link',
    turnosIdeais: 1,
    ownerPaused: true,
    turns: [{ role: 'client', text: 'Oi' }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 0,
      noCtaUrl: true,
      outboundIncludes: ['Olá!'],
      outboundExcludes: [/Abrir agenda/],
    },
  },
  {
    id: 'GU-15',
    title: 'Preço de serviço único: responde e junta «Abrir agenda» com o serviço, sem marcar (P6)',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Quanto custa a limpeza de pele?' }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 0,
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'agendar', serviceId: 'Limpeza de pele' }],
      turns: [{ turn: 0, matches: [/R\$/, /Abrir agenda/] }],
    },
  },
  {
    id: 'GU-16',
    title: 'Preço leva «Abrir agenda» com o serviço (P6); marcar depois leva o link outra vez',
    turnosIdeais: 2,
    turns: [
      { role: 'client', text: 'Quanto custa a limpeza de pele?' },
      { role: 'client', text: 'Quero marcar limpeza de pele' },
    ],
    expect: {
      ...NEVER_BOOKS,
      appointments: 0,
      clientWebOffers: 2,
      clientWebPurposes: [
        { purpose: 'agendar', serviceId: 'Limpeza de pele' },
        { purpose: 'agendar', serviceId: 'Limpeza de pele' },
      ],
      turns: [{ turn: 0, matches: [/R\$/, /Abrir agenda/], excludes: [/Quer ver hor[aá]rios/i] }],
    },
  },
  {
    id: 'GU-17',
    title: 'Duas bolhas seguidas: um só link',
    turnosIdeais: 1,
    turns: [{ role: 'burst', texts: ['oi', 'quero marcar massagem'] }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 0,
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'agendar', serviceId: 'Massagem' }],
    },
  },
  {
    id: 'GU-18',
    title: 'Confirmar não marca: nenhum texto do cliente fecha uma marcação no chat',
    turnosIdeais: 2,
    turns: [
      { role: 'client', text: 'Quero marcar limpeza de pele amanhã às 15h' },
      { role: 'client', text: 'Sim, pode confirmar' },
    ],
    expect: {
      ...NEVER_BOOKS,
      appointments: 0,
      outboundExcludes: [/Agendado:/, /Remarcado:/, /Cancelado:/],
    },
  },
  {
    id: 'GU-22',
    title:
      'Depois do link de remarcar, «Pode ser as 10:15» não aceita hora — reenvia Abrir agenda (DEC-202)',
    turnosIdeais: 2,
    prepare: withOneAppointment,
    turns: [
      { role: 'client', text: 'Quero reagendar meu horário' },
      { role: 'client', text: 'Pode ser as 10:15' },
    ],
    expect: {
      ...NEVER_BOOKS,
      appointments: 1,
      clientWebOffers: 2,
      clientWebPurposes: [
        { purpose: 'remarcar', appointmentId: 'apt_gu_1' },
        { purpose: 'remarcar', appointmentId: 'apt_gu_1' },
      ],
      outboundIncludes: [
        'Para remarcar',
        'Para escolher data e hora',
        'Abrir agenda',
      ],
      outboundExcludes: [
        /Qual fica melhor/i,
        /Horário já não está livre/i,
        /equipe vai confirmar/i,
        /Tenho .+\d{2}:\d{2}/,
      ],
      turns: [
        { turn: 0, matches: [/Para remarcar/] },
        { turn: 1, matches: [/Para escolher data e hora/, /não marca nem remarca por texto/] },
      ],
    },
  },
  {
    id: 'GU-23',
    title:
      'Posso ajudar: cta_url Abrir agenda (sem reply que reenvia «toque em Abrir agenda»)',
    turnosIdeais: 0,
    // Janela 24 h; o autodraft não corre (sem turno client no harness após o prepare).
    prepare: (s) => {
      s.sayInbound('(cliente acabou de confirmar)')
    },
    turns: [
      {
        role: 'owner',
        note: 'follow-up pós-agendamento com URL → cta_url na mesma bolha (DEC-202 / Meta)',
        act: async (s) => {
          const offered = await s.prepareClientWebOffer?.({
            tenantId: s.tenantId,
            conversationId: s.conversationId,
            purpose: 'agendar',
            appointmentId: null,
            serviceId: null,
          })
          const url = offered?.ctaUrl?.url
          if (!url) throw new Error('GU-23: harness sem URL')
          const follow = sendPostBookingFollowupOp(
            s.db,
            s.caller,
            {
              conversationId: s.conversationId,
              appointmentId: 'apt_gu23',
              agendaUrl: url,
            },
            s.clock,
          )
          if (follow.status !== 'queued') {
            throw new Error(`GU-23: esperava queued, veio ${follow.status}`)
          }
        },
      },
    ],
    expect: {
      outboundIncludes: [POST_BOOKING_BODY],
      outboundExcludes: [/Para agendar, toque em/i],
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'agendar', serviceId: null }],
      assert: (s) => {
        const errs: string[] = []
        const help = s.outboundBodies().filter((b) => b === POST_BOOKING_BODY)
        if (help.length !== 1) {
          errs.push(`esperava 1 «${POST_BOOKING_BODY}», saíram ${help.length}`)
        }
        const row = s.db.get<{ interactive_json: string | null }>(
          `SELECT o.interactive_json AS interactive_json
           FROM outbound_messages o
           JOIN messages m ON m.id = o.message_id
           WHERE o.tenant_id = ? AND m.conversation_id = ? AND m.body = ?
           ORDER BY o.created_at DESC LIMIT 1`,
          s.tenantId,
          s.conversationId,
          POST_BOOKING_BODY,
        )
        if (!row?.interactive_json) {
          errs.push('GU-23: Posso ajudar sem interactivo')
          return errs
        }
        const parsed = JSON.parse(row.interactive_json) as {
          ctaUrl?: { displayText?: string; url?: string }
          buttons?: unknown[]
        }
        if (parsed.ctaUrl?.displayText !== CLIENT_WEB_CTA_TEXT) {
          errs.push(
            `esperava cta_url «${CLIENT_WEB_CTA_TEXT}», veio ${JSON.stringify(parsed.ctaUrl?.displayText)}`,
          )
        }
        if (!/^https:\/\/[^/]+\/c\/cw1_[A-Za-z0-9_-]{20,}$/.test(parsed.ctaUrl?.url ?? '')) {
          errs.push(`cta_url sem forma de token, veio ${JSON.stringify(parsed.ctaUrl?.url)}`)
        }
        if (parsed.buttons?.length) {
          errs.push(
            `Posso ajudar não deve ter reply (Meta: cta_url exclusivo); veio ${JSON.stringify(parsed.buttons)}`,
          )
        }
        const bookPhrases = s.outboundBodies().filter((b) => /Para agendar, toque em/i.test(b))
        if (bookPhrases.length > 0) {
          errs.push('não deve sair a frase redundante «Para agendar, toque em Abrir agenda»')
        }
        return errs
      },
    },
  },
  {
    id: 'GU-24',
    title:
      '«Quero ver os meus agendamentos»: link da página (home), sem lista em texto (TRE-74)',
    turnosIdeais: 1,
    prepare: withOneAppointment,
    turns: [{ role: 'client', text: 'Quero ver os meus agendamentos' }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 1,
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'home' }],
      outboundIncludes: ['Abrir agenda', 'ver as suas marcações'],
      outboundExcludes: [
        /Você tem \d/i,
        /é só pedir aqui/i,
        /Vou pedir para a equipe/i,
        /\b\d{2}:\d{2}\b/,
      ],
      notPaused: true,
    },
  },
  {
    id: 'GU-25',
    title: '«Meus agendamentos» sem marcação futura: link home, sem handoff (TRE-74)',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'quais são os meus agendamentos?' }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 0,
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'home' }],
      outboundIncludes: ['Abrir agenda', 'Você não tem horário marcado'],
      outboundExcludes: [/é só pedir aqui/i, /Vou pedir para a equipe/i],
      notPaused: true,
    },
  },
  {
    id: 'GU-26',
    title:
      'Fora do expediente, «quero cancelar» manda Abrir agenda — não handoff DEC-113 (TRE-74)',
    turnosIdeais: 1,
    /** Qui 19/11/2026 21:42 America/Sao_Paulo (mesmo relógio G-10b). */
    nowMs: Date.UTC(2026, 10, 20, 0, 42),
    prepare: withOneAppointment,
    turns: [{ role: 'client', text: 'quero cancelar' }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 1,
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'cancelar', appointmentId: 'apt_gu_1' }],
      outboundIncludes: ['Para cancelar', 'Abrir agenda'],
      outboundExcludes: [
        /Vou pedir para a equipe/i,
        /A equipe responde a partir/i,
      ],
      notPaused: true,
    },
  },
  {
    id: 'GU-19',
    title: 'Pergunta de política de cancelamento é informação, não pedido de cancelar',
    turnosIdeais: 1,
    prepare: withOneAppointment,
    turns: [{ role: 'client', text: 'Se eu precisar cancelar, tem multa?' }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 1,
      noCtaUrl: true,
    },
  },
  {
    id: 'GU-20',
    title: '«Falar com a equipe» ganha ao link',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Quero falar com uma pessoa para marcar' }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 0,
      noCtaUrl: true,
      paused: true,
    },
  },
  {
    id: 'GU-21',
    title:
      'Quem atende: informação com «Abrir agenda» + «Falar com a equipe» (DEC-216); sem CTA URL até o toque',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Quem faz a limpeza de pele?' }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 0,
      noCtaUrl: true,
      turns: [{ turn: 0, matches: [/Quem atende|atendimento é feito por|quem atende é/i] }],
      assert: (s) => {
        const row = s.db.get<{ interactive_json: string | null }>(
          `SELECT o.interactive_json AS interactive_json
           FROM outbound_messages o
           JOIN messages m ON m.id = o.message_id
           WHERE o.tenant_id = ? AND m.conversation_id = ?
           ORDER BY o.created_at DESC LIMIT 1`,
          s.tenantId,
          s.conversationId,
        )
        if (!row?.interactive_json) return ['GU-21: resposta sem botões interactivos']
        const parsed = JSON.parse(row.interactive_json) as {
          buttons?: Array<{ id: string; title: string }>
        }
        const buttons = parsed.buttons ?? []
        const hasAgenda = buttons.some(
          (b) => b.title === 'Abrir agenda' && b.id.startsWith(OPEN_AGENDA_REPLY_BUTTON_ID),
        )
        const hasTeam = buttons.some(
          (b) => b.id === HUMAN_HANDOFF_BUTTON_ID && b.title === HUMAN_HANDOFF_BUTTON_TITLE,
        )
        if (!hasAgenda || !hasTeam) {
          return [`GU-21: esperava Abrir agenda + Equipe, veio ${JSON.stringify(buttons)}`]
        }
        if (buttons.length !== 2) {
          return [`GU-21: esperava exactamente 2 botões, veio ${buttons.length}`]
        }
        return []
      },
    },
  },
  {
    id: 'CW-12',
    title:
      'Cancelar na página: um só recibo Cancelado (com frase da página) + Posso ajudar (DEC-086)',
    turnosIdeais: 1,
    prepare: withOneAppointment,
    turns: [
      { role: 'client', text: 'Preciso cancelar minha marcação' },
      {
        role: 'owner',
        note: 'cliente confirma o cancelamento na página web (mesmo caminho do Clinic DO)',
        act: async (s) => {
          const webCaller = workerCaller(s.tenantId, WEB_CANCEL_ACTOR)
          const done = cancelFromWeb(s.db, webCaller, s.clock, { contactId: s.contactId }, 'apt_gu_1')
          if (done.result.status !== 'cancelled') {
            throw new Error(`CW-12: esperava cancelled, veio ${done.result.status}`)
          }
          const cancelled = done.result
          const offered = await s.prepareClientWebOffer?.({
            tenantId: s.tenantId,
            conversationId: s.conversationId,
            purpose: 'agendar',
          })
          appendWebCancelChatEffects(
            s.db,
            webCaller,
            {
              conversationId: s.conversationId,
              appointmentId: 'apt_gu_1',
              serviceName: cancelled.serviceName,
              startsAt: cancelled.startsAt,
              agendaUrl: offered?.ctaUrl?.url ?? null,
            },
            s.clock,
            done.outbox,
          )
        },
      },
    ],
    expect: {
      proposal: false,
      appointments: 1, // linha cancelada continua na BD; status assert abaixo
      // cancelar (pedido no chat) + agendar (Posso ajudar cta_url)
      clientWebOffers: 2,
      clientWebPurposes: [
        { purpose: 'cancelar', appointmentId: 'apt_gu_1' },
        { purpose: 'agendar', serviceId: null },
      ],
      outboundIncludes: ['Para cancelar', 'Cancelado:', WEB_CANCEL_RECEIPT_SENTENCE, POST_BOOKING_BODY],
      assert: (s) => {
        const errs: string[] = []
        const cancelados = s.outboundBodies().filter((b) => b.startsWith('Cancelado:'))
        if (cancelados.length !== 1) {
          errs.push(`esperava 1 «Cancelado:…», saíram ${cancelados.length}`)
        } else if (!cancelados[0]!.includes(WEB_CANCEL_RECEIPT_SENTENCE)) {
          errs.push('recibo sem frase da página')
        }
        const row = s.db.get<{ status: string; cancelled_by: string | null }>(
          `SELECT status, cancelled_by FROM appointments WHERE id = ?`,
          'apt_gu_1',
        )
        if (row?.status !== 'cancelled' || row.cancelled_by !== WEB_CANCEL_ACTOR) {
          errs.push(`marcação não cancelada por ${WEB_CANCEL_ACTOR}`)
        }
        const help = s.outboundBodies().filter((b) => b === POST_BOOKING_BODY)
        if (help.length !== 1) errs.push(`esperava 1 «${POST_BOOKING_BODY}», saíram ${help.length}`)
        const helpRow = s.db.get<{ interactive_json: string | null }>(
          `SELECT o.interactive_json AS interactive_json
           FROM outbound_messages o
           JOIN messages m ON m.id = o.message_id
           WHERE o.tenant_id = ? AND m.conversation_id = ? AND m.body = ?
           ORDER BY o.created_at DESC LIMIT 1`,
          s.tenantId,
          s.conversationId,
          POST_BOOKING_BODY,
        )
        const parsed = JSON.parse(helpRow?.interactive_json ?? '{}') as {
          ctaUrl?: { displayText?: string }
          buttons?: unknown[]
        }
        if (parsed.ctaUrl?.displayText !== CLIENT_WEB_CTA_TEXT) {
          errs.push(`Posso ajudar sem cta_url Abrir agenda, veio ${JSON.stringify(parsed)}`)
        }
        if (parsed.buttons?.length) {
          errs.push('Posso ajudar não deve misturar reply com cta_url')
        }
        return errs
      },
    },
  },
  {
    id: 'CW-13',
    title:
      'Serviço sem profissional: catálogo da página e proposta recusam marcar (Conferir / DEC-085)',
    turnosIdeais: 1,
    prepare: (s) => {
      const bronze = listServices(s.db, s.tenantId).find((row) => row.name === 'Bronzeamento')
      if (!bronze) throw new Error('CW-13: Bronzeamento ausente no cenário')
      upsertServiceOp(
        s.db,
        s.caller,
        {
          id: bronze.id,
          name: bronze.name,
          durationMinutes: bronze.durationMinutes,
          bufferMinutes: bronze.bufferMinutes,
          priceCents: bronze.priceCents,
          professionalIds: [],
          roomRequirement: bronze.roomRequirement,
        },
        s.clock,
      )
    },
    turns: [
      { role: 'client', text: 'Quero marcar bronzeamento amanhã às 10h' },
      {
        role: 'owner',
        note: 'cliente tenta Confirmar na página com Bronzeamento sem profissional (mesmo caminho do Clinic DO)',
        act: (s) => {
          const catalog = readClientWebCatalog(s.db, s.tenantId, s.clock)
          if (catalog.services.some((svc) => svc.id === s.ids.bronzeamento || svc.name === 'Bronzeamento')) {
            throw new Error('CW-13: Bronzeamento ainda no catálogo da página')
          }
          const avail = queryAvailability(
            s.db,
            s.tenantId,
            { serviceId: s.ids.bronzeamento, date: '2026-11-06' },
            s.clock,
          )
          if (avail.slots.length > 0) {
            throw new Error(`CW-13: motor ainda devolveu ${avail.slots.length} hora(s) sem profissional`)
          }
          // Forçar o caminho de proposta com Gi (como no WA «com Gi» da evidência).
          try {
            createOrSupersedeProposal(
              s.db,
              s.tenantId,
              {
                contactId: s.contactId,
                conversationId: s.conversationId,
                serviceId: s.ids.bronzeamento,
                professionalId: s.ids.gi,
                startsAt: zonedCivilToUtc(GU_TZ, 2026, 11, 6, 10, 0),
                zoneIds: null,
              },
              s.clock,
            )
            throw new Error('CW-13: proposta criada apesar de lista vazia de profissionais')
          } catch (err) {
            if (err instanceof ValidationError && err.code === 'professional_not_on_service') return
            throw err
          }
        },
      },
    ],
    expect: {
      ...NEVER_BOOKS,
      appointments: 0,
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'agendar', serviceId: 'Bronzeamento' }],
      outboundExcludes: [/Agendado:/],
      assert: (s) => {
        const errs: string[] = []
        if (s.appointmentCount() !== 0) errs.push('marcação inesperada com serviço sem profissional')
        if (s.proposalCount() !== 0) errs.push('proposta inesperada com serviço sem profissional')
        return errs
      },
    },
  },
  {
    id: 'CW-14',
    title:
      'Agendado pela página: CTA «Abrir mapa», sem URL Local no corpo (DEC-211 opção B)',
    turnosIdeais: 0,
    // Inbound só para abrir a janela 24 h; o autodraft não corre (sem turno client no harness).
    prepare: (s) => {
      s.sayInbound('(cliente confirma na página)')
    },
    turns: [
      {
        role: 'owner',
        note: 'marcação confirmada na página → recibo Agendado com cta_url Abrir mapa',
        act: (s) => {
          const proposal = createProposal(
            s.db,
            s.tenantId,
            {
              contactId: s.contactId,
              conversationId: s.conversationId,
              serviceId: s.ids.limpeza,
              professionalId: s.ids.ana,
              startsAt: zonedCivilToUtc(GU_TZ, 2026, 11, 21, 9, 0),
            },
            s.clock,
          )
          if (!proposal.clinicLocationText.startsWith('https://')) {
            throw new Error('CW-14: cenário sem link de localização Google')
          }
          markProposalSent(s.db, s.tenantId, proposal.id, s.clock)
          markProposalConfirmed(s.db, s.tenantId, proposal.id, s.clock, 'apt_cw14')
          const result = sendProposalResultMessageOp(
            s.db,
            s.caller,
            { proposalId: proposal.id, resultKind: 'booked', channel: 'web' },
            s.clock,
          )
          if (result.status !== 'queued') {
            throw new Error(`CW-14: esperava queued, veio ${result.status}`)
          }
        },
      },
    ],
    expect: {
      outboundIncludes: ['Agendado:', WEB_RECEIPT_SENTENCE],
      outboundExcludes: [/Local:\s*https?:\/\//i, /https?:\/\/maps/i],
      assert: (s) => {
        const errs: string[] = []
        const agendados = s.outboundBodies().filter((b) => b.startsWith('Agendado:'))
        if (agendados.length !== 1) {
          errs.push(`esperava 1 «Agendado:…», saíram ${agendados.length}`)
        } else if (!agendados[0]!.includes(WEB_RECEIPT_SENTENCE)) {
          errs.push('recibo sem frase da página')
        } else if (/Local:|https?:\/\//i.test(agendados[0]!)) {
          errs.push('Agendado ainda cola URL / Local no corpo')
        }
        const row = s.db.get<{ interactive_json: string | null }>(
          `SELECT o.interactive_json AS interactive_json
           FROM outbound_messages o
           JOIN messages m ON m.id = o.message_id
           WHERE o.tenant_id = ? AND m.conversation_id = ? AND m.body LIKE 'Agendado:%'
           ORDER BY o.created_at DESC LIMIT 1`,
          s.tenantId,
          s.conversationId,
        )
        if (!row?.interactive_json) {
          errs.push('Agendado sem interactivo')
          return errs
        }
        const parsed = JSON.parse(row.interactive_json) as {
          ctaUrl?: { displayText?: string; url?: string }
        }
        if (parsed.ctaUrl?.displayText !== OPEN_MAP_CTA_TEXT) {
          errs.push(
            `esperava cta_url «${OPEN_MAP_CTA_TEXT}», veio ${JSON.stringify(parsed.ctaUrl?.displayText)}`,
          )
        }
        if (!parsed.ctaUrl?.url?.startsWith('https://maps.app.goo.gl/')) {
          errs.push(`cta_url sem link Maps, veio ${JSON.stringify(parsed.ctaUrl?.url)}`)
        }
        return errs
      },
    },
  },
  {
    id: 'CW-15',
    title:
      'Preferência / Sem preferência: filtra horas, rodízio por serviço e nome no recibo (DEC-218)',
    turnosIdeais: 0,
    prepare: (s) => {
      s.sayInbound('(cliente confirma na página)')
    },
    turns: [
      {
        role: 'owner',
        note:
          'página: preferência Ana filtra; Sem preferência roda Ana→Bia no mesmo serviço; Feito/recibo com nome',
        act: async (s) => {
          const catalog = readClientWebCatalog(s.db, s.tenantId, s.clock)
          const svc = catalog.services.find((row) => row.id === s.ids.limpeza)
          if (!svc || svc.professionals.length < 2) {
            throw new Error('CW-15: Limpeza precisa de ≥2 profissionais no catálogo da página')
          }
          const names = svc.professionals.map((p) => p.name)
          if (!names.includes('Ana') || !names.includes('Bia')) {
            throw new Error(`CW-15: esperava Ana e Bia, veio ${names.join(', ')}`)
          }

          const day = '2026-11-06'
          const onlyAna = await listClientWebSlots(s.db, s.tenantId, s.clock, {
            serviceId: s.ids.limpeza,
            variantIds: [],
            from: day,
            to: day,
            professionalId: s.ids.ana,
          })
          if (!onlyAna.ok || onlyAna.slots.length === 0) {
            throw new Error('CW-15: preferência Ana sem horas')
          }
          const bad = await listClientWebSlots(s.db, s.tenantId, s.clock, {
            serviceId: s.ids.limpeza,
            variantIds: [],
            from: day,
            to: day,
            professionalId: 'pro-inventada',
          })
          if (bad.ok || bad.error !== 'professional_invalid') {
            throw new Error('CW-15: profissional inventada deveria ser professional_invalid')
          }

          const session = { contactId: s.contactId, conversationId: s.conversationId }
          const first = await planWebProposal(s.db, s.tenantId, s.clock, session, {
            serviceId: s.ids.limpeza,
            variantIds: [],
            line: null,
            slotId: `${day}T10:00`,
          })
          if (!first.ok) throw new Error(`CW-15: 1.ª proposta falhou (${first.error})`)
          if (first.proposal.professionalId !== s.ids.ana) {
            throw new Error(
              `CW-15: 1.ª Sem preferência deveria ser Ana, veio ${first.proposal.professionalId}`,
            )
          }
          if (readRrLastProfessional(s.db, s.tenantId, s.ids.limpeza) !== s.ids.ana) {
            throw new Error('CW-15: cursor RR não gravou Ana após Sem preferência')
          }

          const second = await planWebProposal(s.db, s.tenantId, s.clock, session, {
            serviceId: s.ids.limpeza,
            variantIds: [],
            line: null,
            slotId: `${day}T11:00`,
          })
          if (!second.ok) throw new Error(`CW-15: 2.ª proposta falhou (${second.error})`)
          if (second.proposal.professionalId !== s.ids.bia) {
            throw new Error(
              `CW-15: 2.ª Sem preferência deveria ser Bia (rodízio), veio ${second.proposal.professionalId}`,
            )
          }

          const preferred = await planWebProposal(s.db, s.tenantId, s.clock, session, {
            serviceId: s.ids.limpeza,
            variantIds: [],
            line: null,
            slotId: `${day}T14:00`,
            professionalId: s.ids.bia,
          })
          if (!preferred.ok) throw new Error(`CW-15: preferência Bia falhou (${preferred.error})`)
          if (preferred.proposal.professionalId !== s.ids.bia) {
            throw new Error('CW-15: preferência explícita não fixou Bia')
          }
          if (readRrLastProfessional(s.db, s.tenantId, s.ids.limpeza) !== s.ids.bia) {
            throw new Error('CW-15: preferência explícita não deve apagar o cursor RR')
          }

          // Recibo no chat com o nome atribuído (RR-6), mesmo caminho de CW-14 (sem INV-01).
          const proposal = createProposal(
            s.db,
            s.tenantId,
            {
              contactId: s.contactId,
              conversationId: s.conversationId,
              serviceId: s.ids.limpeza,
              professionalId: s.ids.ana,
              startsAt: zonedCivilToUtc(GU_TZ, 2026, 11, 7, 9, 0),
            },
            s.clock,
          )
          markProposalSent(s.db, s.tenantId, proposal.id, s.clock)
          markProposalConfirmed(s.db, s.tenantId, proposal.id, s.clock, 'apt_cw15')
          const result = sendProposalResultMessageOp(
            s.db,
            s.caller,
            { proposalId: proposal.id, resultKind: 'booked', channel: 'web' },
            s.clock,
          )
          if (result.status !== 'queued') {
            throw new Error(`CW-15: esperava queued no recibo, veio ${result.status}`)
          }
        },
      },
    ],
    expect: {
      appointments: 0,
      outboundIncludes: ['Agendado:', WEB_RECEIPT_SENTENCE, 'com Ana'],
      assert: (s) => {
        const errs: string[] = []
        const agendados = s.outboundBodies().filter((b) => b.startsWith('Agendado:'))
        if (agendados.length !== 1) {
          errs.push(`esperava 1 «Agendado:…», saíram ${agendados.length}`)
        } else if (!agendados[0]!.includes('com Ana')) {
          errs.push('recibo sem «com Ana» (DEC-218 RR-6)')
        } else if (!agendados[0]!.includes(WEB_RECEIPT_SENTENCE)) {
          errs.push('recibo sem frase da página')
        }
        return errs
      },
    },
  },
]
