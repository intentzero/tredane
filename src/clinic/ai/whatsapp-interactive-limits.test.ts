/**
 * Regressão staging f8507868 (16/11/2026): listas de horários com a linha
 * «Falar com a equipe» (#868) falhavam no envio com Meta 400 / 131009.
 * Causa: o augment abria uma 2.ª secção «Atendimento» ao lado da secção única
 * sem título da lista; com mais de uma secção a Cloud API exige `title` em todas.
 * Monta os payloads reais (lista, botões, proposta) e verifica os limites Meta.
 * Dados fictícios.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { bootClinicDb } from '../test-db'
import type { SendOutboundInteractiveInput } from '../inbox/types'
import { renderProposalInteractive } from '../proposals/render'
import type { AppointmentProposalRow } from '../proposals/types'
import {
  META_BUTTON_TITLE_MAX,
  META_LIST_BUTTON_MAX,
  META_LIST_MAX_ROWS,
  META_LIST_ROW_DESCRIPTION_MAX,
  META_LIST_ROW_TITLE_MAX,
  META_ROW_ID_MAX,
  buildServiceChoiceButtons,
  buildServiceChoiceList,
  buildSlotChoiceInteractive,
  toSendInteractive,
} from './choice-offer'
import {
  HUMAN_HANDOFF_BUTTON_ID,
  HUMAN_TEAM_LIST_SECTION_TITLE,
  augmentOutboundWithHumanTeam,
} from './human-handoff'

/** Limites Cloud API para interactive (reply buttons). */
const META_MAX_REPLY_BUTTONS = 3
const META_REPLY_BUTTON_ID_MAX = 256
const META_LIST_SECTION_TITLE_MAX = 24

function assertMetaListLimits(interactive: SendOutboundInteractiveInput | null | undefined) {
  const list = interactive?.list
  expect(list).toBeTruthy()
  if (!list) return
  expect(list.button.length).toBeGreaterThan(0)
  expect(list.button.length).toBeLessThanOrEqual(META_LIST_BUTTON_MAX)
  expect(list.sections.length).toBeGreaterThanOrEqual(1)
  expect(list.sections.length).toBeLessThanOrEqual(10)
  if (list.sections.length > 1) {
    for (const sec of list.sections) {
      expect(sec.title?.trim()).toBeTruthy()
    }
  }
  for (const sec of list.sections) {
    if (sec.title) expect(sec.title.length).toBeLessThanOrEqual(META_LIST_SECTION_TITLE_MAX)
    expect(sec.rows.length).toBeGreaterThan(0)
  }
  const rows = list.sections.flatMap((s) => s.rows)
  expect(rows.length).toBeLessThanOrEqual(META_LIST_MAX_ROWS)
  expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length)
  for (const r of rows) {
    expect(r.id.length).toBeGreaterThan(0)
    expect(r.id.length).toBeLessThanOrEqual(META_ROW_ID_MAX)
    expect(r.title.length).toBeGreaterThan(0)
    expect(r.title.length).toBeLessThanOrEqual(META_LIST_ROW_TITLE_MAX)
    if (r.description != null) {
      expect(r.description.length).toBeLessThanOrEqual(META_LIST_ROW_DESCRIPTION_MAX)
    }
  }
}

function assertMetaButtonLimits(buttons: Array<{ id: string; title: string }> | undefined) {
  expect(buttons?.length ?? 0).toBeGreaterThan(0)
  expect(buttons!.length).toBeLessThanOrEqual(META_MAX_REPLY_BUTTONS)
  expect(new Set(buttons!.map((b) => b.id)).size).toBe(buttons!.length)
  expect(new Set(buttons!.map((b) => b.title)).size).toBe(buttons!.length)
  for (const b of buttons!) {
    expect(b.id.length).toBeLessThanOrEqual(META_REPLY_BUTTON_ID_MAX)
    expect(b.title.length).toBeGreaterThan(0)
    expect(b.title.length).toBeLessThanOrEqual(META_BUTTON_TITLE_MAX)
  }
}

function fakeSlots(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const hh = String(8 + i).padStart(2, '0')
    return {
      key: `2026-11-20T${hh}:00`,
      label: `quarta-feira 20/11 às ${hh}:00 com a profissional`,
      description: `quarta-feira 20/11 às ${hh}:00 com a profissional Fictícia de Teste`,
    }
  })
}

function withHarness<T>(fn: (h: { db: ReturnType<typeof bootClinicDb>['db']; clock: ReturnType<typeof createControllableClock> }) => T): T {
  const clock = createControllableClock(Date.UTC(2026, 10, 17, 2, 22))
  const boot = bootClinicDb({ clock })
  try {
    return fn({ db: boot.db, clock })
  } finally {
    boot.close()
  }
}

describe('WhatsApp interactive limits com «Falar com a equipe» (regressão f8507868)', () => {
  it('lista de horários (1…10 vagas) com a linha humana respeita os limites Meta', () => {
    withHarness(({ db, clock }) => {
      for (let n = 1; n <= META_LIST_MAX_ROWS; n++) {
        const { interactive } = buildSlotChoiceInteractive({
          catalogVersion: 'cv_test_0001',
          slots: fakeSlots(n),
        })
        const aug = augmentOutboundWithHumanTeam(db, 't_limits', clock, {
          body: 'Horários:',
          interactive: toSendInteractive(interactive),
        })
        assertMetaListLimits(aug.interactive)
        const rows = aug.interactive!.list!.sections.flatMap((s) => s.rows)
        if (n < META_LIST_MAX_ROWS) {
          expect(rows.some((r) => r.id === HUMAN_HANDOFF_BUTTON_ID)).toBe(true)
          // Secção única sem título: a linha humana entra nela (não abre 2.ª secção).
          expect(aug.interactive!.list!.sections).toHaveLength(1)
        }
      }
    })
  })

  it('lista de serviços (máx. vagas) com a linha humana respeita os limites Meta', () => {
    withHarness(({ db, clock }) => {
      const services = Array.from({ length: META_LIST_MAX_ROWS - 1 }, (_, i) => ({
        id: `svc_${i}`,
        name: `Serviço fictício número ${i} com nome longo`,
      }))
      const { interactive } = buildServiceChoiceList('cv_test_0001', services)
      const aug = augmentOutboundWithHumanTeam(db, 't_limits', clock, {
        body: 'Serviços:',
        interactive: toSendInteractive(interactive),
      })
      assertMetaListLimits(aug.interactive)
    })
  })

  it('lista com secções tituladas ganha secção «Atendimento» titulada', () => {
    withHarness(({ db, clock }) => {
      const aug = augmentOutboundWithHumanTeam(db, 't_limits', clock, {
        body: 'Horários:',
        interactive: {
          list: {
            button: 'Horários',
            sections: [
              { title: 'Manhã', rows: [{ id: 'slot:1', title: '09:00' }] },
              { title: 'Tarde', rows: [{ id: 'slot:2', title: '14:00' }] },
            ],
          },
        },
      })
      assertMetaListLimits(aug.interactive)
      const secs = aug.interactive!.list!.sections
      expect(secs).toHaveLength(3)
      expect(secs[2]!.title).toBe(HUMAN_TEAM_LIST_SECTION_TITLE)
    })
  })

  it('botões de serviço (1…3) com o botão humano ficam ≤3 e títulos ≤20', () => {
    withHarness(({ db, clock }) => {
      for (let n = 1; n <= 3; n++) {
        const services = Array.from({ length: n }, (_, i) => ({
          id: `svc_${i}`,
          name: `Serviço fictício ${i} extra longo`,
        }))
        const { interactive } = buildServiceChoiceButtons('cv_test_0001', services)
        const aug = augmentOutboundWithHumanTeam(db, 't_limits', clock, {
          body: 'Qual serviço?',
          interactive: toSendInteractive(interactive),
        })
        assertMetaButtonLimits(aug.interactive?.buttons)
      }
    })
  })

  it('proposta com «Falar com a equipe» fica ≤3 botões e títulos ≤20', () => {
    const proposal = {
      id: 'prop_limits_test',
      tenantId: 't1',
      contactId: 'c1',
      conversationId: 'cnv1',
      serviceId: 'svc1',
      serviceName: 'Serviço fictício',
      professionalId: 'p1',
      professionalName: 'Fictícia',
      startsAt: Date.UTC(2026, 10, 20, 12, 0),
      endsAt: Date.UTC(2026, 10, 20, 13, 0),
      durationMinutes: 60,
      timezone: 'America/Sao_Paulo',
      priceCents: 15000,
      requiresSignal: false,
      signalKind: null,
      signalFixedCents: null,
      signalPercent: null,
      signalConditionsText: '',
      clinicLocationText: '',
      version: 1,
      state: 'enviada',
      beneficiaryKind: 'titular',
      replacesAppointmentId: null,
      expiresAt: null,
      createdAt: 0,
      updatedAt: 0,
    } as AppointmentProposalRow
    const rendered = renderProposalInteractive(proposal)
    assertMetaButtonLimits(rendered.buttons)
    expect(rendered.body.length).toBeLessThanOrEqual(1024)
  })
})
