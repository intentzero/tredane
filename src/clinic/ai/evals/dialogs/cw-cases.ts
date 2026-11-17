/**
 * Família CW- — página web da cliente oferecida no chat (ADR-0018, Fase 5; DEC-196).
 * A abertura do hub leva o botão «Abrir agenda» em vez do CTA do Flow quando a página está ligada
 * (plataforma e owner). O corpo é determinístico (DEC-104). Texto **Proposto**.
 *
 * Relógio por defeito: qui 05/11/2026 10:00 America/Sao_Paulo (clínica aberta 09:00–18:00).
 */
import { zonedCivilToUtc } from '../../../scheduling'
import type { DialogCase } from './runner'
import type { DialogScenario } from './scenario'

const HUB_OPENING = /Hoje funcionamos das 09:00 às 18:00/
const OFFER = /Para agendar, remarcar ou cancelar, toque em «Abrir agenda»\. Para tirar dúvidas, escreva aqui\./
const NO_LEAK = [/America\/|Sao_Paulo|São Paulo \(/, /maps\.google|goo\.gl/i, /\{|\}|\[Flow\]/, /cw1_/]

const TZ = 'America/Sao_Paulo'

function seedFutureAppointment(
  s: DialogScenario,
  opts: { id: string; serviceId: string; professionalId: string; startsAt: number },
) {
  s.db.run(
    `INSERT INTO appointments (id, tenant_id, service_id, professional_id, starts_at, ends_at, status, created_at, contact_id, confirmed_by)
     VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, 'system:proposal-send')`,
    opts.id,
    s.tenantId,
    opts.serviceId,
    opts.professionalId,
    opts.startsAt,
    opts.startsAt + 60 * 60_000,
    s.clock.nowMs() - 60_000,
    s.contactId,
  )
}

const RESCHEDULE_OFFER = /Para remarcar, toque em «Abrir agenda» e escolha a nova data e hora\./
const CANCEL_OFFER = /Para cancelar, toque em «Abrir agenda» e confirme a marcação\./

export const CW_DIALOG_CASES: DialogCase[] = [
  {
    id: 'CW-01',
    title: 'Hub: «Oi» abre com o expediente de hoje e o botão «Abrir agenda» (sem Flow)',
    turnosIdeais: 1,
    clientWeb: true,
    turns: [{ role: 'client', text: 'Oi' }],
    expect: {
      clientWebOffers: 1,
      proposal: false,
      notPaused: true,
      outboundCount: 1,
      // O token vai só no botão: nunca no corpo da mensagem.
      outboundExcludes: [...NO_LEAK, /Falar com a equipe/, /O que você precisa\?/, /Abrir opções/],
      turns: [{ turn: 0, matches: [HUB_OPENING, OFFER] }],
    },
  },
  {
    id: 'CW-02',
    title: 'Pedido vago de marcar («quero marcar») recebe o mesmo botão',
    turnosIdeais: 1,
    clientWeb: true,
    turns: [{ role: 'client', text: 'Quero marcar um horário' }],
    expect: {
      clientWebOffers: 1,
      proposal: false,
      notPaused: true,
      outboundCount: 1,
      outboundExcludes: NO_LEAK,
      turns: [{ turn: 0, matches: [OFFER] }],
    },
  },
  {
    id: 'CW-03',
    title: 'Serviço nomeado no pedido segue o funil: não abre link',
    turnosIdeais: 2,
    clientWeb: true,
    turns: [{ role: 'client', text: 'Quero marcar massagem amanhã às 10h' }],
    expect: {
      clientWebOffers: 0,
      noCtaUrl: true,
      notPaused: true,
      outboundExcludes: NO_LEAK,
    },
  },
  {
    id: 'CW-04',
    title: 'Pergunta de informação não abre link (as dúvidas continuam no chat)',
    turnosIdeais: 1,
    clientWeb: true,
    turns: [{ role: 'client', text: 'Quanto custa a massagem?' }],
    expect: {
      clientWebOffers: 0,
      noCtaUrl: true,
      notPaused: true,
      outboundExcludes: NO_LEAK,
    },
  },
  {
    id: 'CW-05',
    title: 'Com a página desligada, «Oi» não leva botão de URL',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Oi' }],
    expect: {
      noCtaUrl: true,
      outboundExcludes: NO_LEAK,
    },
  },
  {
    id: 'CW-06',
    title: 'Remarcar com uma marcação futura: o link abre direto nela (finalidade remarcar)',
    turnosIdeais: 1,
    clientWeb: true,
    prepare: (s) =>
      seedFutureAppointment(s, {
        id: 'apt_cw_06',
        serviceId: s.ids.peeling,
        professionalId: s.ids.bia,
        startsAt: zonedCivilToUtc(TZ, 2026, 11, 25, 10, 0),
      }),
    turns: [{ role: 'client', text: 'Quero remarcar meu horário' }],
    expect: {
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'remarcar', appointmentId: 'apt_cw_06' }],
      proposal: false,
      notPaused: true,
      outboundCount: 1,
      outboundExcludes: NO_LEAK,
      turns: [{ turn: 0, matches: [RESCHEDULE_OFFER] }],
    },
  },
  {
    id: 'CW-07',
    title: 'Cancelar com uma marcação futura: o link abre direto nela (finalidade cancelar), sem pausar',
    turnosIdeais: 1,
    clientWeb: true,
    prepare: (s) =>
      seedFutureAppointment(s, {
        id: 'apt_cw_07',
        serviceId: s.ids.peeling,
        professionalId: s.ids.bia,
        startsAt: zonedCivilToUtc(TZ, 2026, 11, 25, 10, 0),
      }),
    turns: [{ role: 'client', text: 'Quero cancelar meu horário' }],
    expect: {
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'cancelar', appointmentId: 'apt_cw_07' }],
      proposal: false,
      notPaused: true,
      outboundCount: 1,
      outboundExcludes: NO_LEAK,
      turns: [{ turn: 0, matches: [CANCEL_OFFER] }],
    },
  },
  {
    id: 'CW-08',
    title: 'Com duas marcações futuras o link de cancelar não leva marcação alvo',
    turnosIdeais: 1,
    clientWeb: true,
    prepare: (s) => {
      seedFutureAppointment(s, { id: 'apt_cw_08a', serviceId: s.ids.peeling, professionalId: s.ids.bia, startsAt: zonedCivilToUtc(TZ, 2026, 11, 25, 10, 0) })
      seedFutureAppointment(s, { id: 'apt_cw_08b', serviceId: s.ids.peeling, professionalId: s.ids.bia, startsAt: zonedCivilToUtc(TZ, 2026, 11, 27, 14, 0) })
    },
    turns: [{ role: 'client', text: 'Quero cancelar meu horário' }],
    expect: {
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'cancelar', appointmentId: null }],
      notPaused: true,
      outboundExcludes: NO_LEAK,
    },
  },
  {
    id: 'CW-09',
    title: 'Sem marcação futura, «quero cancelar» não abre link (segue o caminho de hoje: equipe)',
    turnosIdeais: 1,
    clientWeb: true,
    turns: [{ role: 'client', text: 'Quero cancelar meu horário' }],
    expect: {
      clientWebOffers: 0,
      noCtaUrl: true,
      paused: true,
    },
  },
  {
    id: 'CW-10',
    title: 'Página desligada: «quero cancelar» com marcação segue o caminho conversacional (sem botão de URL)',
    turnosIdeais: 1,
    prepare: (s) =>
      seedFutureAppointment(s, {
        id: 'apt_cw_10',
        serviceId: s.ids.peeling,
        professionalId: s.ids.bia,
        startsAt: zonedCivilToUtc(TZ, 2026, 11, 25, 10, 0),
      }),
    turns: [{ role: 'client', text: 'Quero cancelar meu horário' }],
    expect: {
      noCtaUrl: true,
      outboundExcludes: NO_LEAK,
    },
  },
]
