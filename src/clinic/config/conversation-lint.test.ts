/**
 * Cada regra do lint DEC-112 / #418 tem um teste.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import {
  lintConversationPaths,
  lintServiceConversationPath,
  replaceServiceZonesOp,
  setResourceActiveOp,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from './index'

describe('lintConversationPaths (DEC-112 / #418)', () => {
  it('deteta serviço sem profissional', () => {
    const clock = createControllableClock(Date.UTC(2026, 9, 27, 12, 0, 0))
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller('clinic-demo-lint-a', 'user_synth_owner_a')
      const svc = upsertServiceOp(
        db,
        caller,
        {
          name: 'Limpeza',
          durationMinutes: 60,
          bufferMinutes: 0,
          priceCents: 10000,
          professionalIds: [],
          roomRequirement: { mode: 'none' },
        },
        clock,
      )
      const findings = lintServiceConversationPath(db, caller.tenantId, svc.id, clock)
      expect(findings.map((f) => f.code)).toContain('no_professional')
      expect(findings.find((f) => f.code === 'no_professional')?.message).toMatch(/conversa/)
    } finally {
      close()
    }
  })

  it('deteta linha sem variantes ativas', () => {
    const clock = createControllableClock(Date.UTC(2026, 9, 27, 12, 0, 0))
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller('clinic-demo-lint-b', 'user_synth_owner_a')
      const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi' }, clock)
      setWeeklyWindowsOp(
        db,
        caller,
        {
          resourceId: pro.id,
          windows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 }],
        },
        clock,
      )
      const svc = upsertServiceOp(
        db,
        caller,
        {
          name: 'Depilação',
          durationMinutes: 15,
          bufferMinutes: 0,
          priceCents: null,
          variantKind: 'zona',
          variantKindPlural: 'zonas',
          professionalIds: [pro.id],
          roomRequirement: { mode: 'none' },
        },
        clock,
      )
      // Sem replaceServiceZones → linha com tipo e zero variantes.
      const findings = lintServiceConversationPath(db, caller.tenantId, svc.id, clock)
      expect(findings.map((f) => f.code)).toContain('line_without_variants')
    } finally {
      close()
    }
  })

  it('deteta variante sem preço com sinal em percentagem', () => {
    const clock = createControllableClock(Date.UTC(2026, 9, 27, 12, 0, 0))
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller('clinic-demo-lint-c', 'user_synth_owner_a')
      const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Ana' }, clock)
      setWeeklyWindowsOp(
        db,
        caller,
        {
          resourceId: pro.id,
          windows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 }],
        },
        clock,
      )
      const svc = upsertServiceOp(
        db,
        caller,
        {
          name: 'Peeling com sinal',
          durationMinutes: 45,
          bufferMinutes: 0,
          priceCents: null,
          variantKind: 'técnica',
          variantKindPlural: 'técnicas',
          professionalIds: [pro.id],
          roomRequirement: { mode: 'none' },
          requiresSignal: true,
          signalKind: 'percent',
          signalPercent: 30,
        },
        clock,
      )
      replaceServiceZonesOp(
        db,
        caller,
        svc.id,
        [{ name: 'Face', audience: 'ambos', durationMinutes: 45, priceCents: null }],
        clock,
      )
      const findings = lintServiceConversationPath(db, caller.tenantId, svc.id, clock)
      expect(findings.map((f) => f.code)).toContain('percent_signal_without_price')
    } finally {
      close()
    }
  })

  it('deteta janela do serviço fora do expediente das profissionais', () => {
    const clock = createControllableClock(Date.UTC(2026, 9, 27, 12, 0, 0))
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller('clinic-demo-lint-d', 'user_synth_owner_a')
      const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Bia' }, clock)
      // Profissional só de manhã.
      setWeeklyWindowsOp(
        db,
        caller,
        {
          resourceId: pro.id,
          windows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 12 * 60 }],
        },
        clock,
      )
      const svc = upsertServiceOp(
        db,
        caller,
        {
          name: 'Massagem noturna',
          durationMinutes: 50,
          bufferMinutes: 0,
          priceCents: 15000,
          professionalIds: [pro.id],
          roomRequirement: { mode: 'none' },
          // Serviço só à noite — não cruza.
          weeklyWindows: [{ dayOfWeek: 1, startMinute: 18 * 60, endMinute: 22 * 60 }],
        },
        clock,
      )
      const findings = lintServiceConversationPath(db, caller.tenantId, svc.id, clock)
      expect(findings.map((f) => f.code)).toContain('window_outside_hours')
    } finally {
      close()
    }
  })

  it('deteta serviço com salas sem sala ativa (sala sem horário / sem caminho)', () => {
    const clock = createControllableClock(Date.UTC(2026, 9, 27, 12, 0, 0))
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller('clinic-demo-lint-e', 'user_synth_owner_a')
      const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1' }, clock)
      const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi' }, clock)
      setWeeklyWindowsOp(
        db,
        caller,
        {
          resourceId: pro.id,
          windows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 }],
        },
        clock,
      )
      const svc = upsertServiceOp(
        db,
        caller,
        {
          name: 'Depilação',
          durationMinutes: 30,
          bufferMinutes: 0,
          priceCents: 8000,
          professionalIds: [pro.id],
          roomRequirement: { mode: 'rooms', resourceIds: [room.id] },
        },
        clock,
      )
      // Desativa a única sala → percurso sem saída.
      setResourceActiveOp(db, caller, room.id, false, clock)
      const findings = lintServiceConversationPath(db, caller.tenantId, svc.id, clock)
      expect(findings.map((f) => f.code)).toContain('room_without_hours')
    } finally {
      close()
    }
  })

  it('serviço completo não gera achados', () => {
    const clock = createControllableClock(Date.UTC(2026, 9, 26, 12, 0, 0))
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller('clinic-demo-lint-ok', 'user_synth_owner_a')
      const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1' }, clock)
      const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi' }, clock)
      setWeeklyWindowsOp(
        db,
        caller,
        {
          resourceId: pro.id,
          windows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 18 * 60 }],
        },
        clock,
      )
      upsertServiceOp(
        db,
        caller,
        {
          name: 'Limpeza',
          durationMinutes: 60,
          bufferMinutes: 0,
          priceCents: 18000,
          professionalIds: [pro.id],
          roomRequirement: { mode: 'rooms', resourceIds: [room.id] },
        },
        clock,
      )
      expect(lintConversationPaths(db, caller.tenantId, clock)).toEqual([])
    } finally {
      close()
    }
  })
})
