/**
 * DEC-089 / S2 — nome e género do atendente virtual.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { CLINIC_SCHEMA_VERSION } from '../constants'
import { bootClinicDb } from '../test-db'
import { ensureClinicSettings, setClinicAiProfile } from './settings'
import { buildSystemPrompt } from '../../ai/prompt'
import type { AiGenerateInput } from '../../ai/types'
import { ValidationError } from '../errors'

describe('DEC-089 virtual attendant', () => {
  it('migração 45 sobe CLINIC_SCHEMA_VERSION e grava colunas vazias', () => {
    const clock = createControllableClock(Date.UTC(2026, 9, 31))
    const { db, close } = bootClinicDb({ clock })
    try {
      expect(CLINIC_SCHEMA_VERSION).toBe(47)
      const state = db.get<{ version: number; status: string }>(
        'SELECT version, status FROM clinic_schema_state WHERE id = 1',
      )
      expect(state).toEqual({ version: 46, status: 'ready' })
      const cols = db
        .all<{ name: string }>(`PRAGMA table_info(clinic_settings)`)
        .map((c) => c.name)
      expect(cols).toContain('virtual_attendant_name')
      expect(cols).toContain('virtual_attendant_gender')
      const s = ensureClinicSettings(db, 'clinic-demo-a', clock)
      expect(s.virtualAttendantName).toBe('')
      expect(s.virtualAttendantGender).toBeNull()
    } finally {
      close()
    }
  })

  it('grava nome e género feminino', () => {
    const clock = createControllableClock(Date.UTC(2026, 9, 31))
    const { db, close } = bootClinicDb({ clock })
    try {
      const next = setClinicAiProfile(
        db,
        'clinic-demo-a',
        {
          virtualAttendantName: '  Luna  ',
          virtualAttendantGender: 'feminino',
        },
        clock,
      )
      expect(next.virtualAttendantName).toBe('Luna')
      expect(next.virtualAttendantGender).toBe('feminino')
    } finally {
      close()
    }
  })

  it('limpa género com string vazia', () => {
    const clock = createControllableClock(Date.UTC(2026, 9, 31))
    const { db, close } = bootClinicDb({ clock })
    try {
      setClinicAiProfile(
        db,
        'clinic-demo-a',
        { virtualAttendantName: 'Leo', virtualAttendantGender: 'masculino' },
        clock,
      )
      const cleared = setClinicAiProfile(
        db,
        'clinic-demo-a',
        { virtualAttendantGender: '' },
        clock,
      )
      expect(cleared.virtualAttendantName).toBe('Leo')
      expect(cleared.virtualAttendantGender).toBeNull()
    } finally {
      close()
    }
  })

  it('recusa género inválido', () => {
    const clock = createControllableClock(Date.UTC(2026, 9, 31))
    const { db, close } = bootClinicDb({ clock })
    try {
      expect(() =>
        setClinicAiProfile(
          db,
          'clinic-demo-a',
          { virtualAttendantGender: 'ambos' as 'masculino' },
          clock,
        ),
      ).toThrow(ValidationError)
    } finally {
      close()
    }
  })

  it('persona feminina entra no system prompt', () => {
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
          address: null,
          timezone: 'America/Sao_Paulo',
          nowLabel: 'sábado',
          today: '2026-10-31',
          openingHours: [],
          freeSlots: [],
          upcomingAppointments: [],
          reschedulePolicy: null,
          cancellationPolicy: null,
          virtualAttendantName: 'Luna',
          virtualAttendantGender: 'feminino' as const,
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
    expect(prompt).toContain('Luna')
    expect(prompt).toContain('feminina')
    expect(prompt).toContain('concordância no feminino')
  })
})
