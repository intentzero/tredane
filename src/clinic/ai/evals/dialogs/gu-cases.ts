/**
 * Família GU- (DEC-202): o chat não marca, não remarca e não cancela.
 * Pedido de marcar, remarcar, cancelar ou de vaga recebe uma frase fixa e o botão «Abrir agenda»
 * com o propósito certo; a IA só informa. Com a pausa da owner, passa à equipe.
 */
import { zonedCivilToUtc } from '../../../scheduling'
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
]
