/**
 * Família GU- (DEC-202): o chat não marca, não remarca e não cancela.
 * Pedido de marcar, remarcar, cancelar ou de vaga recebe uma frase fixa e o botão «Abrir agenda»
 * com o propósito certo; a IA só informa. Com a pausa da owner, passa à equipe.
 *
 * CW-12: efeito no chat depois do cancelamento **na página** (recibo único + DEC-086).
 * CW-13: serviço sem profissional — a página e a proposta recusam marcar (Conferir / DEC-085).
 * CW-14: Agendado page-booked com CTA «Abrir mapa» (DEC-211 opção B; sem URL Local no corpo).
 * CW-15: preferência / Sem preferência — filtra horas e rodízio por serviço (DEC-218).
 * CW-16: combos de zonas no catálogo da página e preço DEC-080 na proposta (TRE-88).
 * CW-17: Remarcado na página — «de <hora antiga> para <hora nova>» (TRE-93; não «de X para X»).
 * GU-23: «Posso ajudar…» reply Abrir agenda|Terminar; toque → cta_url corpo mínimo (TRE-81).
 * GU-24–26: ver/listar agendamentos e cancelar fora do expediente → link (TRE-74).
 * GU-28: fecho «por agora é só» → despedida + cta_url Abrir agenda (TRE-82).
 * GU-29: remarcar fora do expediente → Abrir agenda, sem handoff DEC-113 (TRE-83).
 */
import { listServices, replaceServiceCombosOp, upsertServiceOp } from '../../../config'
import { readComboSnapshot } from '../../../config/combos'
import { ValidationError } from '../../../errors'
import { workerCaller } from '../../../envelopes'
import {
  handlePostBookingButtonClick,
  POST_BOOKING_BODY,
  postBookingButtonId,
  sendPostBookingFollowupOp,
} from '../../../followup/post-booking'
import { sendOutboundMessageOp } from '../../../inbox/operations'
import { createOrSupersedeProposal } from '../../../proposals/proposals'
import { queryAvailability, zonedCivilToUtc } from '../../../scheduling'
import {
  appendWebCancelChatEffects,
  cancelFromWeb,
  planWebReschedule,
  WEB_CANCEL_ACTOR,
  WEB_CANCEL_RECEIPT_SENTENCE,
} from '../../../../clientweb/manage'
import {
  CLIENT_WEB_CTA_MINIMAL_BODY,
  CLIENT_WEB_CTA_TEXT,
  OPEN_AGENDA_REPLY_BUTTON_ID,
} from '../../../../clientweb/offer'
import { listClientWebSlots, planWebProposal, readClientWebCatalog } from '../../../../clientweb/booking'
import { readRrLastProfessional } from '../../../../clientweb/round-robin'
import { OPEN_MAP_CTA_TEXT } from '../../location-map-offer'
import { HUMAN_HANDOFF_BUTTON_ID, HUMAN_HANDOFF_BUTTON_TITLE } from '../../human-handoff'
import {
  createProposal,
  executeProposalConfirmOp,
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

export const withOneAppointment = (s: DialogScenario) =>
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
    title: 'Pedido completo com serviço nomeado: cta_url Abrir agenda (home)',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Quero marcar massagem relaxante amanhã às 10h' }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 0,
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'home', serviceId: null }],
      outboundIncludes: ['Abrir agenda', 'Massagem relaxante'],
      outboundExcludes: [/\b\d{2}:\d{2}\b/],
    },
  },
  {
    id: 'GU-02',
    title: '«Quero marcar» sem serviço: cta_url Abrir agenda (home)',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Quero marcar' }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 0,
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'home', serviceId: null }],
    },
  },
  {
    id: 'GU-31',
    title: '«Me mostra a agenda»: frase DEC-202 + cta_url home (sem LLM / sem Equipe)',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Me mostra a agenda novamente' }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 0,
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'home', serviceId: null }],
      outboundIncludes: ['Abrir agenda'],
      outboundExcludes: [
        /horários livres/i,
        /mensagem anterior/i,
        /Falar com a equipe/i,
        /😊/,
      ],
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
      clientWebPurposes: [{ purpose: 'home', serviceId: null }],
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
      clientWebPurposes: [{ purpose: 'home', serviceId: null }],
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
      clientWebPurposes: [{ purpose: 'home', serviceId: null }],
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
      clientWebPurposes: [{ purpose: 'home', serviceId: null }],
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
      clientWebPurposes: [{ purpose: 'home', serviceId: null }],
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
      clientWebPurposes: [{ purpose: 'home', serviceId: null }],
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
        { purpose: 'home', serviceId: null },
        { purpose: 'home', serviceId: null },
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
      clientWebPurposes: [{ purpose: 'home', serviceId: null }],
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
      'Posso ajudar: reply Abrir agenda|Terminar; toque → cta_url corpo mínimo (TRE-81)',
    turnosIdeais: 0,
    // Janela 24 h; o autodraft não corre (sem turno client no harness após o prepare).
    prepare: (s) => {
      s.sayInbound('(cliente acabou de confirmar)')
    },
    turns: [
      {
        role: 'owner',
        note: 'follow-up pós-agendamento (reply) + toque Abrir agenda → cta_url mínimo',
        act: async (s) => {
          const follow = sendPostBookingFollowupOp(
            s.db,
            s.caller,
            {
              conversationId: s.conversationId,
              appointmentId: 'apt_gu23',
            },
            s.clock,
          )
          if (follow.status !== 'queued') {
            throw new Error(`GU-23: esperava queued, veio ${follow.status}`)
          }
          const click = handlePostBookingButtonClick(
            s.db,
            {
              tenantId: s.tenantId,
              conversationId: s.conversationId,
              buttonId: postBookingButtonId('apt_gu23', 'another'),
              providerEventKey: 'wa:gu23:another',
            },
            s.clock,
          )
          if (!click.handled || click.action !== 'another') {
            throw new Error('GU-23: toque Abrir agenda não tratado')
          }
          const offered = await s.prepareClientWebOffer?.({
            tenantId: s.tenantId,
            conversationId: s.conversationId,
            purpose: 'home',
            appointmentId: null,
            serviceId: null,
          })
          if (!offered?.ctaUrl) throw new Error('GU-23: harness sem URL')
          // Espelha Clinic DO `#offerWebLinkInChat` com corpo mínimo (TRE-81).
          sendOutboundMessageOp(
            s.db,
            s.caller,
            {
              conversationId: s.conversationId,
              body: CLIENT_WEB_CTA_MINIMAL_BODY,
              interactive: offered,
              clientRequestId: 'ai-web-agendar:wa:gu23:another',
              authorClerkUserId: 'system:ai-autodraft',
              authorDisplayName: 'Assistente',
            },
            s.clock,
          )
        },
      },
    ],
    expect: {
      outboundIncludes: [POST_BOOKING_BODY],
      outboundExcludes: [/Para agendar, toque em/i],
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'home', serviceId: null }],
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
          ctaUrl?: unknown
          buttons?: Array<{ id?: string; title?: string }>
        }
        if (parsed.ctaUrl) {
          errs.push('Posso ajudar não deve misturar cta_url com reply')
        }
        const titles = (parsed.buttons ?? []).map((b) => b.title)
        if (!titles.includes('Abrir agenda') || !titles.includes('Terminar')) {
          errs.push(
            `esperava reply Abrir agenda|Terminar, veio ${JSON.stringify(parsed.buttons)}`,
          )
        }
        const ctaRow = s.db.get<{ body: string; interactive_json: string | null }>(
          `SELECT m.body AS body, o.interactive_json AS interactive_json
           FROM outbound_messages o
           JOIN messages m ON m.id = o.message_id
           WHERE o.tenant_id = ? AND m.conversation_id = ?
             AND o.interactive_json LIKE '%ctaUrl%'
             AND o.interactive_json LIKE '%Abrir agenda%'
           ORDER BY o.created_at DESC LIMIT 1`,
          s.tenantId,
          s.conversationId,
        )
        if (!ctaRow?.interactive_json) {
          errs.push('GU-23: após toque, faltou cta_url Abrir agenda')
        } else {
          const cta = JSON.parse(ctaRow.interactive_json) as {
            ctaUrl?: { displayText?: string; url?: string }
          }
          if (cta.ctaUrl?.displayText !== CLIENT_WEB_CTA_TEXT) {
            errs.push(`cta_url sem «${CLIENT_WEB_CTA_TEXT}»`)
          }
          if (!/^https:\/\/[^/]+\/c\/cw1_[A-Za-z0-9_-]{20,}$/.test(cta.ctaUrl?.url ?? '')) {
            errs.push(`cta_url sem forma de token, veio ${JSON.stringify(cta.ctaUrl?.url)}`)
          }
          if (ctaRow.body !== CLIENT_WEB_CTA_MINIMAL_BODY) {
            errs.push('corpo do cta_url deve ser mínimo (sem CLIENT_WEB_BOOK_BODY)')
          }
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
    id: 'GU-29',
    title:
      'Fora do expediente, «Quero remarcar o meu agendamento» manda Abrir agenda — não handoff DEC-113 (TRE-83)',
    turnosIdeais: 1,
    /** Qui 19/11/2026 21:42 America/Sao_Paulo (mesmo relógio GU-26). */
    nowMs: Date.UTC(2026, 10, 20, 0, 42),
    prepare: withOneAppointment,
    turns: [{ role: 'client', text: 'Quero remarcar o meu agendamento' }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 1,
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'remarcar', appointmentId: 'apt_gu_1' }],
      outboundIncludes: ['Para remarcar', 'Abrir agenda'],
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
    title: '«Falar com a equipe» por texto → botão (sem pausa automática)',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Quero falar com uma pessoa para marcar' }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 0,
      noCtaUrl: true,
      notPaused: true,
      outboundIncludes: ['Se preferir falar com a equipe', 'Falar com a equipe'],
      outboundExcludes: [/Vou pedir para a equipe continuar daqui/i],
    },
  },
  {
    id: 'GU-30',
    title:
      'Com teto de links já atingido, «Quero remarcar…» manda frase + reply Abrir agenda — sem handoff',
    turnosIdeais: 1,
    /** Qui 19/11/2026 21:42 America/Sao_Paulo (fora do expediente; mesmo relógio GU-26). */
    nowMs: Date.UTC(2026, 10, 20, 0, 42),
    prepare: (s) => {
      withOneAppointment(s)
      // Simula 5 links recentes (teto) sem frases iguais no diálogo (INV-08).
      const now = s.clock.nowMs()
      for (let i = 0; i < 5; i++) {
        const messageId = `msg_gu30_link_${i}`
        const createdAt = now - 60_000 + i
        s.db.run(
          `INSERT INTO messages (
            id, tenant_id, conversation_id, direction, body,
            external_message_id, delivery_state,
            author_clerk_user_id, author_display_name, created_at
          ) VALUES (?, ?, ?, 'outbound', ?, NULL, 'accepted', 'system:ai-autodraft', 'IA', ?)`,
          messageId,
          s.tenantId,
          s.conversationId,
          `Link prévio ${i + 1}`,
          createdAt,
        )
        s.db.run(
          `INSERT INTO outbound_messages (
            id, tenant_id, conversation_id, message_id, client_request_id,
            provider_message_id, kind, template_name, template_language,
            template_params_json, interactive_json, delivery_state, failure_reason, outbox_event_id,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, NULL, 'interactive', NULL, NULL, NULL, ?, 'accepted', NULL, NULL, ?, ?)`,
          `ob_gu30_${i}`,
          s.tenantId,
          s.conversationId,
          messageId,
          `ai-web-agendar:seed_${i}`,
          JSON.stringify({
            ctaUrl: { displayText: 'Abrir agenda', url: `https://app.l1.test/c/seed${i}` },
          }),
          createdAt,
          createdAt,
        )
      }
    },
    turns: [{ role: 'client', text: 'Quero remarcar o meu agendamento' }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 1,
      notPaused: true,
      outboundIncludes: ['Para remarcar', 'Abrir agenda'],
      outboundExcludes: [
        /Vou pedir para a equipe/i,
        /A equipe responde a partir/i,
      ],
      assert: (s) => {
        const row = s.db.get<{ interactive_json: string | null }>(
          `SELECT o.interactive_json AS interactive_json
           FROM outbound_messages o
           JOIN messages m ON m.id = o.message_id
           WHERE o.tenant_id = ? AND m.conversation_id = ?
             AND o.client_request_id LIKE 'ai-web-remarcar:%'
           ORDER BY o.created_at DESC LIMIT 1`,
          s.tenantId,
          s.conversationId,
        )
        if (!row?.interactive_json?.includes('cw:abrir-agenda')) {
          return [`GU-30: esperava reply Abrir agenda, veio ${row?.interactive_json ?? 'null'}`]
        }
        if (row.interactive_json.includes('ctaUrl')) {
          return ['GU-30: com teto não deve emitir novo cta_url']
        }
        return []
      },
    },
  },
  {
    id: 'GU-21',
    title:
      'Quem atende: informação + cta_url «Abrir agenda» (home); sem reply Equipe na mesma bolha (DEC-220)',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Quem faz a limpeza de pele?' }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 0,
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'home', serviceId: null }],
      turns: [{ turn: 0, matches: [/Quem atende|atendimento é feito por|quem atende é/i] }],
      outboundExcludes: [/Falar com a equipe/i],
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
        if (!row?.interactive_json) return ['GU-21: resposta sem interactivo']
        const parsed = JSON.parse(row.interactive_json) as {
          buttons?: Array<{ id: string; title: string }>
          ctaUrl?: { displayText?: string }
        }
        if (parsed.ctaUrl?.displayText !== 'Abrir agenda') {
          return [`GU-21: esperava cta_url Abrir agenda, veio ${row.interactive_json}`]
        }
        const buttons = parsed.buttons ?? []
        if (buttons.some((b) => b.id === HUMAN_HANDOFF_BUTTON_ID || b.id.startsWith(OPEN_AGENDA_REPLY_BUTTON_ID))) {
          return [`GU-21: não deve ter reply Abrir agenda/Equipe, veio ${JSON.stringify(buttons)}`]
        }
        return []
      },
    },
  },
  {
    id: 'GU-27',
    title:
      '«Pode me atender amanhã?»: expediente do sábado + Abrir agenda; sem pedir serviço nem equipe (TRE-77)',
    turnosIdeais: 1,
    /** Sex 20/11/2026 16:20 America/Sao_Paulo — evidência horario-abrir-agenda/wa2.jpg. */
    nowMs: Date.UTC(2026, 10, 20, 19, 20),
    turns: [{ role: 'client', text: 'Você pode-me atender amanhã?' }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 0,
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'home', serviceId: null }],
      outboundIncludes: ['Abrir agenda'],
      outboundExcludes: [
        /Qual serviço/i,
        /procedimento/i,
        /Falar com a equipe/i,
        /equipe confirma/i,
        /nossa equipe/i,
      ],
      turns: [
        {
          turn: 0,
          matches: [/amanh[aã]/i, /s[aá]bado/i, /09:00/i, /Abrir agenda/i],
          excludes: [
            /Qual serviço/i,
            /procedimento/i,
            /equipe confirma/i,
            /Me conta/i,
          ],
        },
      ],
      turnDecided: [{ modelCalled: false, route: 'skip:web_agendar_link' }],
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
        if (!row?.interactive_json) return ['GU-27: resposta sem interactivo']
        const parsed = JSON.parse(row.interactive_json) as {
          buttons?: Array<{ id: string; title: string }>
          ctaUrl?: { displayText?: string }
        }
        if (parsed.ctaUrl?.displayText !== 'Abrir agenda') {
          return [`GU-27: esperava cta_url Abrir agenda, veio ${row.interactive_json}`]
        }
        const buttons = parsed.buttons ?? []
        const hasTeam = buttons.some(
          (b) => b.id === HUMAN_HANDOFF_BUTTON_ID || b.title === HUMAN_HANDOFF_BUTTON_TITLE,
        )
        if (hasTeam) return ['GU-27: não devia ter «Falar com a equipe»']
        return []
      },
    },
  },
  {
    id: 'GU-28',
    title:
      'Fecho «por agora é só»: despedida + cta_url Abrir agenda (sem reply Equipe) (TRE-82)',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Obrigada, por agora é só' }],
    expect: {
      ...NEVER_BOOKS,
      appointments: 0,
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'home', serviceId: null }],
      outboundExcludes: [/Falar com a equipe/i],
      turns: [
        {
          turn: 0,
          matches: [
            /Perfeito\. Qualquer coisa|Até lá|Combinado\. (Bom dia|Boa tarde|Boa noite)/,
          ],
          excludes: [/Falar com a equipe/i, /não entendi|nao entendi/i],
        },
      ],
      turnDecided: [{ modelCalled: false, route: 'skip:post_booking_farewell' }],
      assert: (s) => {
        const row = s.db.get<{ interactive_json: string | null; body: string }>(
          `SELECT o.interactive_json AS interactive_json, m.body AS body
           FROM outbound_messages o
           JOIN messages m ON m.id = o.message_id
           WHERE o.tenant_id = ? AND m.conversation_id = ?
           ORDER BY o.created_at DESC LIMIT 1`,
          s.tenantId,
          s.conversationId,
        )
        if (!row?.interactive_json) return ['GU-28: despedida sem interactivo']
        const parsed = JSON.parse(row.interactive_json) as {
          buttons?: Array<{ id: string; title: string }>
          ctaUrl?: { displayText?: string; url?: string }
        }
        if (parsed.ctaUrl?.displayText !== CLIENT_WEB_CTA_TEXT) {
          return [`GU-28: esperava cta_url Abrir agenda, veio ${row.interactive_json}`]
        }
        if (parsed.buttons?.length) {
          return [`GU-28: não devia ter reply buttons, veio ${JSON.stringify(parsed.buttons)}`]
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
          appendWebCancelChatEffects(
            s.db,
            webCaller,
            {
              conversationId: s.conversationId,
              appointmentId: 'apt_gu_1',
              serviceName: cancelled.serviceName,
              startsAt: cancelled.startsAt,
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
      // cancelar (pedido no chat); Posso ajudar é reply (CTA só no toque)
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'cancelar', appointmentId: 'apt_gu_1' }],
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
          ctaUrl?: unknown
          buttons?: Array<{ title?: string }>
        }
        if (parsed.ctaUrl) {
          errs.push(`Posso ajudar não deve ter cta_url, veio ${JSON.stringify(parsed)}`)
        }
        const titles = (parsed.buttons ?? []).map((b) => b.title)
        if (!titles.includes('Abrir agenda') || !titles.includes('Terminar')) {
          errs.push(
            `Posso ajudar sem reply Abrir agenda|Terminar, veio ${JSON.stringify(parsed.buttons)}`,
          )
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
      clientWebPurposes: [{ purpose: 'home', serviceId: null }],
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
  {
    id: 'CW-16',
    title:
      'Combos de zonas: catálogo da página lista o combo e a proposta aplica o preço DEC-080',
    turnosIdeais: 1,
    prepare: (s) => {
      const axila = s.db.get<{ id: string }>(
        `SELECT id FROM service_zones WHERE tenant_id = ? AND service_id = ? AND name = ? AND audience = ?`,
        s.tenantId,
        s.ids.depilacao,
        'Axila',
        'feminino',
      )
      const buco = s.db.get<{ id: string }>(
        `SELECT id FROM service_zones WHERE tenant_id = ? AND service_id = ? AND name = ? AND audience = ?`,
        s.tenantId,
        s.ids.depilacao,
        'Buço',
        'ambos',
      )
      if (!axila || !buco) throw new Error('CW-16: Axila feminina ou Buço ausentes no cenário')
      // Soma 40+25 = R$ 65; combo a R$ 50 → economia R$ 15 (DEC-080).
      replaceServiceCombosOp(
        s.db,
        s.caller,
        s.ids.depilacao,
        [
          {
            name: 'Buço + axila',
            priceCents: 5_000,
            zoneIds: [axila.id, buco.id],
            active: true,
          },
        ],
        s.clock,
      )
    },
    turns: [
      { role: 'client', text: 'Quero marcar depilação' },
      {
        role: 'owner',
        note:
          'cliente escolhe o combo Buço + axila na página (catálogo + proposta com priceVisit)',
        act: async (s) => {
          const catalog = readClientWebCatalog(s.db, s.tenantId, s.clock)
          const svc = catalog.services.find((row) => row.id === s.ids.depilacao)
          if (!svc) throw new Error('CW-16: Depilação ausente no catálogo da página')
          if (svc.combos.length !== 1 || svc.combos[0]!.name !== 'Buço + axila') {
            throw new Error(
              `CW-16: esperava 1 combo «Buço + axila» no catálogo, veio ${JSON.stringify(svc.combos)}`,
            )
          }
          const combo = svc.combos[0]!
          if (combo.priceCents !== 5_000 || combo.zoneIds.length !== 2) {
            throw new Error(`CW-16: combo mal formado no catálogo: ${JSON.stringify(combo)}`)
          }
          const day = '2026-11-06'
          const slots = await listClientWebSlots(s.db, s.tenantId, s.clock, {
            serviceId: s.ids.depilacao,
            variantIds: combo.zoneIds,
            from: day,
            to: day,
          })
          if (!slots.ok || slots.slots.length === 0) {
            throw new Error('CW-16: horas livres com as zonas do combo falharam')
          }
          const planned = await planWebProposal(
            s.db,
            s.tenantId,
            s.clock,
            { contactId: s.contactId, conversationId: s.conversationId },
            {
              serviceId: s.ids.depilacao,
              variantIds: combo.zoneIds,
              line: 'feminino',
              slotId: slots.slots[0]!.id,
            },
          )
          if (!planned.ok) {
            throw new Error(`CW-16: proposta web falhou (${planned.error})`)
          }
          if (planned.proposal.priceCents !== 5_000) {
            throw new Error(
              `CW-16: preço da proposta deveria ser R$ 50 (combo), veio ${planned.proposal.priceCents}`,
            )
          }
          const snap = readComboSnapshot(s.db, s.tenantId, 'proposal', planned.proposal.id)
          if (!snap || snap.name !== 'Buço + axila' || snap.priceCents !== 5_000) {
            throw new Error(`CW-16: snapshot do combo ausente ou errado: ${JSON.stringify(snap)}`)
          }
          if (snap.listPriceCents !== 6_500) {
            throw new Error(`CW-16: listPriceCents deveria ser 6500, veio ${snap.listPriceCents}`)
          }
        },
      },
    ],
    expect: {
      appointments: 0,
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'home', serviceId: null }],
      assert: (s) => {
        const errs: string[] = []
        if (s.appointmentCount() !== 0) errs.push('marcação inesperada (só proposta web)')
        if (s.proposalCount() < 1) errs.push('esperava proposta com combo aplicado')
        return errs
      },
    },
  },
  {
    id: 'CW-17',
    title:
      'Remarcado pela página: de <hora antiga> para <hora nova> (TRE-93; não de X para X)',
    turnosIdeais: 0,
    // Marcação em `prepare` → baseline INV-01; o act só remarca (não cria linha nova).
    prepare: (s) => {
      s.sayInbound('(cliente remarca na página)')
      seedFutureAppointment(s, {
        id: 'apt_cw17',
        serviceId: s.ids.limpeza,
        professionalId: s.ids.ana,
        startsAt: zonedCivilToUtc(GU_TZ, 2026, 11, 21, 9, 0),
      })
    },
    turns: [
      {
        role: 'owner',
        note: 'remarca 09:00→09:30 na página; recibo lê o horário antigo do evento rescheduled',
        act: async (s) => {
          const session = { contactId: s.contactId, conversationId: s.conversationId }
          const planned = await planWebReschedule(s.db, s.tenantId, s.clock, session, {
            appointmentId: 'apt_cw17',
            slotId: '2026-11-21T09:30',
          })
          if (!planned.ok) throw new Error(`CW-17: remarcar falhou (${planned.error})`)
          if (planned.proposal.replacesAppointmentId !== 'apt_cw17') {
            throw new Error('CW-17: proposta sem replacesAppointmentId da marcação')
          }
          if (planned.previousStartsAt !== zonedCivilToUtc(GU_TZ, 2026, 11, 21, 9, 0)) {
            throw new Error('CW-17: previousStartsAt do plano não é 09:00')
          }
          const done = await executeProposalConfirmOp(
            s.db,
            s.caller,
            { handoff: planned.handoff, capability: true, channel: 'web' },
            s.clock,
          )
          if (done.status !== 'booked') {
            throw new Error(`CW-17: remarcação veio ${done.status}`)
          }
        },
      },
    ],
    expect: {
      appointments: 1,
      outboundIncludes: ['Remarcado:', WEB_RECEIPT_SENTENCE],
      outboundExcludes: [/Remarcado: de (.+) para \1/],
      assert: (s) => {
        const errs: string[] = []
        const remarcados = s.outboundBodies().filter((b) => b.startsWith('Remarcado:'))
        if (remarcados.length !== 1) {
          errs.push(`esperava 1 «Remarcado:…», saíram ${remarcados.length}`)
          return errs
        }
        const body = remarcados[0]!
        if (
          !/Remarcado: de sábado 21\/11 às 09:00 para sábado 21\/11 às 09:30/.test(body)
        ) {
          errs.push(`recibo sem de 09:00 para 09:30, veio: ${body.slice(0, 120)}`)
        }
        if (!body.includes(WEB_RECEIPT_SENTENCE)) {
          errs.push('recibo remarcado sem frase da página')
        }
        if (/Remarcado: de (.+) para \1/.test(body)) {
          errs.push('Remarcado com horários idênticos (TRE-93)')
        }
        return errs
      },
    },
  },
]
