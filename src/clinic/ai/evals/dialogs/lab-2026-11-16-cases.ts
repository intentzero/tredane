/**
 * Casos L1 da regressão laboratório 1c7fbfae (16/11/2026).
 */
import { createBlockOp } from '../../../config'
import { zonedCivilToUtc } from '../../../scheduling'
import { saveBookingFrame, saveScheduleSession } from '../../schedule-session'
import type { DialogCase } from './runner'
import { DIALOG_NOW_MS } from './scenario'

const TZ = 'America/Sao_Paulo'

function seedFutureAppointment(
  s: import('./scenario').DialogScenario,
  opts: { serviceId: string; professionalId: string; startsAt: number; id: string },
) {
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

export const LAB_2026_11_16_CASES: DialogCase[] = [
  {
    id: 'LAB-813a',
    title: '«já tenho alguma marcação?» lista compromissos, sem handoff',
    turnosIdeais: 1,
    prepare: (s) => {
      seedFutureAppointment(s, {
        id: 'apt_lab_813a',
        serviceId: s.ids.peeling,
        professionalId: s.ids.bia,
        startsAt: zonedCivilToUtc(TZ, 2026, 11, 25, 10, 0),
      })
    },
    turns: [{ role: 'client', text: 'já tenho alguma marcação?' }],
    expect: {
      proposal: false,
      notPaused: true,
      appointments: 1,
      turns: [
        {
          turn: 0,
          matches: [/você tem/i, /\d{2}:\d{2}/, /peeling/i],
          excludes: [/equipe vai verificar/i],
        },
      ],
    },
  },
  {
    id: 'LAB-813b',
    title: '2.º serviço lembra marcação existente antes dos horários',
    turnosIdeais: 1,
    coverageOnly: 'lab-regressao-2026-11-16.regression.test',
    turns: [],
  },
  {
    id: 'LAB-813c',
    title: 'Sem marcação: «tenho horário marcado?» responde sem inventar hora',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'tenho horário marcado?' }],
    expect: {
      proposal: false,
      noAppointment: true,
      turns: [{ turn: 0, matches: [/não tem horário marcado/i] }],
    },
  },
  {
    id: 'LAB-S02',
    title: '«16h30 tem?» alternativas à tarde sem manhã no meio',
    turnosIdeais: 1,
    nowMs: DIALOG_NOW_MS,
    prepare: (s) => {
      const starts = zonedCivilToUtc(TZ, 2026, 11, 6, 16, 30)
      for (const pro of [s.ids.ana, s.ids.bia]) {
        createBlockOp(
          s.db,
          s.caller,
          {
            resourceId: pro,
            startsAt: starts,
            endsAt: starts + 30 * 60_000,
            reason: 'outro',
          },
          s.clock,
        )
      }
    },
    turns: [{ role: 'client', text: 'limpeza de pele amanhã 16h30' }],
    expect: {
      proposal: false,
      turns: [
        {
          turn: 0,
          matches: [/16:30/, /17:00/],
          excludes: [/13:30/],
        },
      ],
    },
  },
  {
    id: 'LAB-S06',
    title: '«amanhã 12:30» nomeia horário ocupado no 1.º turno',
    turnosIdeais: 1,
    nowMs: DIALOG_NOW_MS,
    prepare: (s) => {
      const starts = zonedCivilToUtc(TZ, 2026, 11, 6, 12, 30)
      for (const pro of [s.ids.ana, s.ids.bia]) {
        createBlockOp(
          s.db,
          s.caller,
          {
            resourceId: pro,
            startsAt: starts,
            endsAt: starts + 60 * 60_000,
            reason: 'outro',
          },
          s.clock,
        )
      }
    },
    turns: [{ role: 'client', text: 'limpeza de pele amanha 12:30' }],
    expect: {
      proposal: false,
      turns: [
        {
          turn: 0,
          matches: [/12:30/, /não tenho vaga|já não tenho vaga|já está ocupado|ocupado/i],
        },
      ],
    },
  },
  {
    id: 'LAB-S09b',
    title: '«meio dia e meia» mantém dia após oferta',
    turnosIdeais: 1,
    nowMs: DIALOG_NOW_MS,
    prepare: (s) => {
      const offerDay = '2026-11-10'
      const starts = zonedCivilToUtc(TZ, 2026, 11, 10, 9, 0)
      saveScheduleSession(
        s.db,
        s.tenantId,
        s.conversationId,
        { serviceId: s.ids.limpeza, phase: 'ofertado' },
        s.clock,
      )
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.conversationId,
        {
          serviceId: s.ids.limpeza,
          date: offerDay,
          phase: 'ofertado',
          pending: {
            slot: 'horario',
            options: [{ key: `${offerDay}T09:00`, label: 'segunda 10/11 09:00' }],
            messageId: 'lab-s09b',
          },
          lastOffer: {
            slots: [{ startsAt: starts, professionalId: s.ids.ana }],
            messageId: 'lab-s09b',
          },
        },
        s.clock,
      )
      s.sayOutbound(
        'Os horários disponíveis para segunda 10/11 são 09:00, 09:30, 10:00. Algum serve?',
      )
    },
    turns: [{ role: 'client', text: 'meio dia e meia ta bom sim' }],
    expect: {
      proposal: false,
      turns: [
        {
          turn: 0,
          excludes: [/qual dia fica melhor/i],
          matches: [/12:30|não tenho vaga|já não tenho vaga|Tenho|Confirmar/i],
        },
      ],
    },
  },
]