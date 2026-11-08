import { describe, expect, it } from 'vitest'
import { realizeAskInfo, realizeClarify } from './ask-info-realize'
import type { ServiceRow } from '../config/types'
import type { BookingFrame } from './schedule-session'

const zones = [
  {
    id: 'z_lib',
    tenantId: 't',
    serviceId: 'svc_m',
    name: 'Liberação miofascial',
    audience: 'ambos' as const,
    durationMinutes: 60,
    priceCents: 20_000,
    active: true,
    sortOrder: 0,
    synonyms: [] as string[],
  },
  {
    id: 'z_rel',
    tenantId: 't',
    serviceId: 'svc_m',
    name: 'Massagem relaxante',
    audience: 'ambos' as const,
    durationMinutes: 50,
    priceCents: 15_000,
    active: true,
    sortOrder: 1,
    synonyms: [] as string[],
  },
]

const service = {
  id: 'svc_m',
  name: 'Massagem',
  durationMinutes: 50,
  bufferMinutes: 0,
  priceCents: null,
  active: true,
  professionalIds: [],
  roomRequirement: 'any',
  variantKind: 'tipo',
  variantKindPlural: 'tipos',
  variantSelection: 'uma',
  zones,
  synonyms: [],
} as unknown as ServiceRow

function frame(partial: Partial<BookingFrame>): BookingFrame {
  return {
    phase: 'coletando',
    serviceId: 'svc_m',
    line: null,
    variantIds: null,
    professionalPref: null,
    date: null,
    period: null,
    time: null,
    pending: null,
    lastOffer: null,
    proposal: null,
    rescheduleAppointmentId: null,
    catalogVersion: 'v1',
    provenance: {},
    updatedAt: 1,
    ...partial,
  }
}

describe('realizeAskInfo (DEC-C1 / act-as-policy)', () => {
  it('mid ask-tipo: tabela + pergunta tipo; pending intacta no park', () => {
    const f = frame({
      pending: {
        slot: 'variantes',
        options: [
          { key: 'z_lib', label: 'Liberação miofascial' },
          { key: 'z_rel', label: 'Massagem relaxante' },
        ],
        messageId: 'm_tipo',
      },
    })
    const r = realizeAskInfo({
      conversationId: 'cnv',
      topic: 'price',
      service,
      zones,
      frame: f,
      sameFunnel: true,
    })
    expect(r).not.toBeNull()
    expect(r!.quote.act).toBe('informar_preco_tabela')
    expect(r!.replyText).toMatch(/R\$\s*200,00/)
    expect(r!.replyText).toMatch(/qual tipo você quer/i)
    expect(r!.parked.obligation?.kind).toBe('choose_variants')
    expect(r!.resumedObligation?.kind).toBe('choose_variants')
    expect(r!.stack).toHaveLength(0)
  })

  it('mid slot-offer: cotiza variante e retoma horário (não ask-tipo)', () => {
    const f = frame({
      variantIds: ['z_rel'],
      pending: {
        slot: 'horario',
        options: [{ key: 'k', label: '14:00' }],
        messageId: 'm_slot',
      },
      lastOffer: {
        slots: [{ startsAt: 1, professionalId: 'p' }],
        messageId: 'm_slot',
      },
    })
    const r = realizeAskInfo({
      conversationId: 'cnv',
      topic: 'price',
      service,
      zones,
      frame: f,
      sameFunnel: true,
    })
    expect(r).not.toBeNull()
    expect(r!.quote.act).toBe('informar_preco_variante')
    expect(r!.resume?.act).toBe('perguntar_horario')
    expect(r!.replyText).toMatch(/Massagem relaxante/)
    expect(r!.replyText).toMatch(/R\$\s*150,00/)
    expect(r!.replyText).toMatch(/horário/i)
    expect(r!.replyText).not.toMatch(/qual tipo/i)
    expect(r!.parked.snapshot.variantIds).toEqual(['z_rel'])
  })

  it('clarify park/resume (DEC-C3)', () => {
    const f = frame({
      variantIds: ['z_rel'],
      pending: {
        slot: 'horario',
        options: [{ key: 'k', label: '14:00' }],
        messageId: 'm_c',
      },
    })
    const r = realizeClarify({ conversationId: 'cnv', frame: f })
    expect(r.replyText).toMatch(/outro jeito|equipe/i)
    expect(r.resumedObligation?.kind).toBe('choose_slot')
    expect(r.parked.snapshot.variantIds).toEqual(['z_rel'])
  })
})
