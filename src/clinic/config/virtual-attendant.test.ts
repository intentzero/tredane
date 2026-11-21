/**
 * DEC-089 revista — colunas do atendente virtual removidas (migração 79).
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { CLINIC_SCHEMA_VERSION } from '../constants'
import { bootClinicDb } from '../test-db'
import { ensureClinicSettings, setClinicAiProfile } from './settings'
import { updatePixSignalSettings } from '../pix/signal-settings'
import { buildSystemPrompt } from '../../ai/prompt'
import type { AiGenerateInput } from '../../ai/types'

describe('DEC-089 revista — sem atendente virtual', () => {
  it('migração 79 sobe CLINIC_SCHEMA_VERSION e remove as colunas', () => {
    const clock = createControllableClock(Date.UTC(2026, 9, 31))
    const { db, close } = bootClinicDb({ clock })
    try {
      expect(CLINIC_SCHEMA_VERSION).toBe(81)
      const state = db.get<{ version: number; status: string }>(
        'SELECT version, status FROM clinic_schema_state WHERE id = 1',
      )
      expect(state).toEqual({ version: CLINIC_SCHEMA_VERSION, status: 'ready' })
      const cols = db
        .all<{ name: string }>(`PRAGMA table_info(clinic_settings)`)
        .map((c) => c.name)
      expect(cols).not.toContain('virtual_attendant_name')
      expect(cols).not.toContain('virtual_attendant_gender')
      const s = ensureClinicSettings(db, 'clinic-demo-a', clock)
      expect(s).not.toHaveProperty('virtualAttendantName')
      expect(s).not.toHaveProperty('virtualAttendantGender')
    } finally {
      close()
    }
  })

  it('setClinicAiProfile grava só localização e regras', () => {
    const clock = createControllableClock(Date.UTC(2026, 9, 31))
    const { db, close } = bootClinicDb({ clock })
    try {
      const next = setClinicAiProfile(
        db,
        'clinic-demo-a',
        {
          googleBusinessUrl: 'https://maps.app.goo.gl/demo',
          reschedulePolicy: '  Avise com 24 h.  ',
        },
        clock,
      )
      expect(next.googleBusinessUrl).toBe('https://maps.app.goo.gl/demo')
      expect(next.reschedulePolicy).toBe('Avise com 24 h.')
    } finally {
      close()
    }
  })

  it('com sinal ligado, rejeita regras gerais com prazo de cancelar/remarcar (DEC-210)', () => {
    const clock = createControllableClock(Date.UTC(2026, 9, 31))
    const { db, close } = bootClinicDb({ clock })
    try {
      ensureClinicSettings(db, 'clinic-demo-a', clock)
      updatePixSignalSettings(
        db,
        'clinic-demo-a',
        { enabled: true, amountKind: 'fixed', fixedCents: 5000 },
        clock,
      )
      expect(() =>
        setClinicAiProfile(
          db,
          'clinic-demo-a',
          { reschedulePolicy: 'Avise com 24 h de antecedência.' },
          clock,
        ),
      ).toThrow(/Recebimento do sinal/)
      const ok = setClinicAiProfile(
        db,
        'clinic-demo-a',
        { reschedulePolicy: 'Atrasos acima de 15 minutos podem perder o horário.' },
        clock,
      )
      expect(ok.reschedulePolicy).toMatch(/Atrasos/)
    } finally {
      close()
    }
  })

  it('system prompt não menciona persona configurável', () => {
    const input = {
      kind: 'reply' as const,
      context: {
        contactFirstName: 'Mariana',
        stage: 'em_atendimento',
        services: [],
        messages: [],
        hasClinicOutbound: false,
        clinicOutboundCount: 0,
        clinic: {
          name: 'Aurora',
          timezone: 'America/Sao_Paulo',
          nowLabel: 'sábado',
          today: '2026-10-31',
          openingHours: [],
          reschedulePolicy: null,
          cancellationPolicy: null,
        },
      },
      warnings: [],
      servicesWithoutPrice: [],
      servicesWithoutExplanation: [],
      explanationSources: [],
      maxOutputTokens: 400,
      timeoutMs: 1000,
    } satisfies AiGenerateInput
    const prompt = buildSystemPrompt(input)
    expect(prompt).toContain('assistente de atendimento')
    expect(prompt).not.toMatch(/Persona da clínica|atendente virtual feminina|Luna|Gioconda/)
  })
})
