/**
 * DEC-149 / residual DEC-145 — quoteVisit em modo `uma` + mudança varias→uma.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { saveBookingFrame, getBookingFrame } from '../ai/schedule-session'
import { upsertContact } from '../contacts'
import { createConversation } from '../inbox/conversations'
import { ValidationError, workerCaller } from '../index'
import {
  createOrSupersedeProposal,
  getProposal,
} from '../proposals/proposals'
import { bootClinicDb } from '../test-db'
import {
  quoteVisit,
  replaceServiceCombosOp,
  replaceServiceZonesOp,
  upsertResourceOp,
  upsertServiceOp,
} from './index'

function seedUmaService() {
  const clock = createControllableClock(Date.UTC(2026, 10, 7))
  const { db, close } = bootClinicDb({ clock })
  const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
  const pro = upsertResourceOp(
    db,
    caller,
    { kind: 'professional', name: 'Dra. Paula Reis' },
    clock,
  )
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Massagem',
      durationMinutes: 60,
      bufferMinutes: 15,
      priceCents: 15_000,
      variantKind: 'Tipo',
      variantKindPlural: 'Tipos',
      variantSelection: 'uma',
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  const zones = replaceServiceZonesOp(
    db,
    caller,
    svc.id,
    [
      { name: 'Relaxante', durationMinutes: 50, priceCents: 12_000, audience: 'ambos' },
      { name: 'Liberação miofascial', durationMinutes: 60, priceCents: 18_000, audience: 'ambos' },
    ],
    clock,
  )
  return { db, close, clock, caller, pro, svc: { ...svc, zones }, zones }
}

function seedVariasWithCombos() {
  const clock = createControllableClock(Date.UTC(2026, 10, 7))
  const { db, close } = bootClinicDb({ clock })
  const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
  const pro = upsertResourceOp(
    db,
    caller,
    { kind: 'professional', name: 'Dra. Paula Reis' },
    clock,
  )
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação',
      durationMinutes: 60,
      bufferMinutes: 15,
      variantKind: 'Zona',
      variantKindPlural: 'Zonas',
      variantSelection: 'varias',
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  const zones = replaceServiceZonesOp(
    db,
    caller,
    svc.id,
    [
      { name: 'Axila', durationMinutes: 15, priceCents: 4_000, audience: 'ambos' },
      { name: 'Buço', durationMinutes: 15, priceCents: 3_500, audience: 'feminino' },
      { name: 'Meia perna', durationMinutes: 30, priceCents: 8_000, audience: 'feminino' },
    ],
    clock,
  )
  const combos = replaceServiceCombosOp(
    db,
    caller,
    svc.id,
    [
      {
        name: 'Buço + axila',
        priceCents: 6_500,
        zoneIds: [zones[0]!.id, zones[1]!.id],
        active: true,
      },
    ],
    clock,
  )
  return { db, close, clock, caller, pro, svc: { ...svc, zones }, zones, combos }
}

describe('quoteVisit modo uma (DEC-149)', () => {
  it('aceita exactamente uma variante activa', () => {
    const { db, close, caller, svc, zones } = seedUmaService()
    try {
      const quote = quoteVisit(db, caller.tenantId, svc, [zones[0]!.id])
      expect(quote.durationMinutes).toBe(50)
      expect(quote.priceCents).toBe(12_000)
      expect(quote.zones).toHaveLength(1)
    } finally {
      close()
    }
  })

  it('recusa 0 ids com ValidationError tipado variant_selection_uma', () => {
    const { db, close, caller, svc } = seedUmaService()
    try {
      expect(() => quoteVisit(db, caller.tenantId, svc, [])).toThrow(ValidationError)
      try {
        quoteVisit(db, caller.tenantId, svc, [])
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError)
        expect((err as ValidationError).code).toBe('variant_selection_uma')
        expect((err as ValidationError).details).toMatchObject({
          serviceId: svc.id,
          variantCount: 0,
        })
      }
    } finally {
      close()
    }
  })

  it('recusa N≠1 com ValidationError tipado variant_selection_uma', () => {
    const { db, close, caller, svc, zones } = seedUmaService()
    try {
      expect(() =>
        quoteVisit(db, caller.tenantId, svc, [zones[0]!.id, zones[1]!.id]),
      ).toThrow(ValidationError)
      try {
        quoteVisit(db, caller.tenantId, svc, [zones[0]!.id, zones[1]!.id])
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError)
        expect((err as ValidationError).code).toBe('variant_selection_uma')
        expect((err as ValidationError).details).toMatchObject({
          serviceId: svc.id,
          variantCount: 2,
        })
      }
    } finally {
      close()
    }
  })

  it('modo varias continua a aceitar conjunto compatível', () => {
    const { db, close, clock, caller, svc, zones } = seedVariasWithCombos()
    try {
      const quote = quoteVisit(db, caller.tenantId, { ...svc, variantSelection: 'varias' }, [
        zones[0]!.id,
        zones[1]!.id,
      ])
      expect(quote.zones).toHaveLength(2)
      expect(quote.combo?.name).toBe('Buço + axila')
      // relógio só para tipagem silenciosa
      expect(clock.nowMs()).toBeGreaterThan(0)
    } finally {
      close()
    }
  })
})

describe('mudança varias → uma (DEC-149 / P1)', () => {
  it('recusa gravar uma enquanto houver combo activo e lista o nome', () => {
    const { db, close, clock, caller, svc } = seedVariasWithCombos()
    try {
      expect(() =>
        upsertServiceOp(
          db,
          caller,
          {
            id: svc.id,
            name: svc.name,
            durationMinutes: svc.durationMinutes,
            bufferMinutes: svc.bufferMinutes,
            variantKind: 'Zona',
            variantKindPlural: 'Zonas',
            variantSelection: 'uma',
            professionalIds: svc.professionalIds,
            roomRequirement: { mode: 'none' },
          },
          clock,
        ),
      ).toThrow(ValidationError)
      try {
        upsertServiceOp(
          db,
          caller,
          {
            id: svc.id,
            name: svc.name,
            durationMinutes: svc.durationMinutes,
            bufferMinutes: svc.bufferMinutes,
            variantKind: 'Zona',
            variantKindPlural: 'Zonas',
            variantSelection: 'uma',
            professionalIds: svc.professionalIds,
            roomRequirement: { mode: 'none' },
          },
          clock,
        )
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError)
        expect((err as ValidationError).code).toBe('variant_selection_combos_active')
        expect((err as ValidationError).message).toMatch(/Buço \+ axila/)
        expect((err as ValidationError).details?.comboNames).toEqual(['Buço + axila'])
      }
      const still = db.get<{ variant_selection: string }>(
        `SELECT variant_selection FROM services WHERE id = ?`,
        svc.id,
      )
      expect(still?.variant_selection).toBe('varias')
    } finally {
      close()
    }
  })

  it('sem combos activos grava uma e limpa frame multi + proposta aberta', () => {
    const { db, close, clock, caller, pro, svc, zones } = seedVariasWithCombos()
    try {
      replaceServiceCombosOp(db, caller, svc.id, [], clock)

      const contact = upsertContact(
        db,
        { tenantId: caller.tenantId, waId: '5511999000999', displayName: 'Ana Silva' },
        clock,
      )
      const conversation = createConversation(
        db,
        { tenantId: caller.tenantId, contactId: contact.id, status: 'open' },
        clock,
      )

      saveBookingFrame(
        db,
        caller.tenantId,
        conversation.id,
        {
          serviceId: svc.id,
          variantIds: [zones[0]!.id, zones[1]!.id],
          phase: 'ofertado',
          catalogVersion: '1',
          source: 'regra',
        },
        clock,
        { emitOutbox: false },
      )

      const { proposal } = createOrSupersedeProposal(
        db,
        caller.tenantId,
        {
          conversationId: conversation.id,
          contactId: contact.id,
          serviceId: svc.id,
          professionalId: pro.id,
          startsAt: clock.nowMs() + 3_600_000,
          zoneIds: [zones[0]!.id, zones[1]!.id],
        },
        clock,
      )
      expect(proposal.state).toMatch(/preparada|envio/)

      const updated = upsertServiceOp(
        db,
        caller,
        {
          id: svc.id,
          name: svc.name,
          durationMinutes: svc.durationMinutes,
          bufferMinutes: svc.bufferMinutes,
          variantKind: 'Zona',
          variantKindPlural: 'Zonas',
          variantSelection: 'uma',
          professionalIds: svc.professionalIds,
          roomRequirement: { mode: 'none' },
        },
        clock,
      )
      expect(updated.variantSelection).toBe('uma')

      const frame = getBookingFrame(db, caller.tenantId, conversation.id)
      expect(frame?.serviceId).toBe(svc.id)
      expect(frame?.variantIds).toBeNull()
      expect(frame?.phase).toBe('coletando')

      const after = getProposal(db, caller.tenantId, proposal.id)
      expect(after?.state).toBe('substituida')
    } finally {
      close()
    }
  })
})
