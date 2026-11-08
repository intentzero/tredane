import { describe, expect, it } from 'vitest'
import {
  emptyInterruptStack,
  parkFromFrame,
  parkInterrupt,
  peekInterrupt,
  popInterrupt,
  resumeParkedObligation,
  shouldResumeSlotAsk,
  shouldResumeVariantAsk,
} from './dialogue-interrupt-stack'
import type { BookingFrame } from './schedule-session'

function frame(partial: Partial<BookingFrame>): BookingFrame {
  return {
    phase: 'coletando',
    serviceId: null,
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
    updatedAt: 0,
    ...partial,
  }
}

describe('DialogueInterruptStack (DEC-C4)', () => {
  it('push/pop preserva a obrigação ask-tipo', () => {
    const f = frame({
      serviceId: 'svc_m',
      pending: {
        slot: 'variantes',
        options: [{ key: 'a', label: 'Relaxante' }],
        messageId: 'm1',
      },
    })
    let stack = emptyInterruptStack()
    stack = parkInterrupt(stack, parkFromFrame(f, 'ask_info', 'price'))
    expect(peekInterrupt(stack)?.obligation?.kind).toBe('choose_variants')
    expect(shouldResumeVariantAsk(peekInterrupt(stack)!)).toBe(true)
    expect(shouldResumeSlotAsk(peekInterrupt(stack)!)).toBe(false)

    const { entry, stack: after } = popInterrupt(stack)
    expect(after).toHaveLength(0)
    expect(resumeParkedObligation(entry!)?.kind).toBe('choose_variants')
    expect(entry!.snapshot.serviceId).toBe('svc_m')
  })

  it('mid slot-offer: resume horário, não ask-tipo', () => {
    const f = frame({
      serviceId: 'svc_m',
      variantIds: ['z1'],
      pending: {
        slot: 'horario',
        options: [{ key: 'k', label: '14:00' }],
        messageId: 'm2',
      },
      lastOffer: {
        slots: [{ startsAt: 1, professionalId: 'p' }],
        messageId: 'm2',
      },
    })
    const parked = parkFromFrame(f, 'ask_info', 'price')
    expect(shouldResumeSlotAsk(parked)).toBe(true)
    expect(shouldResumeVariantAsk(parked)).toBe(false)
    expect(resumeParkedObligation(parked)?.kind).toBe('choose_slot')
    expect(parked.snapshot.variantIds).toEqual(['z1'])
  })

  it('clarify park não limpa variante no snapshot', () => {
    const f = frame({
      serviceId: 'svc_m',
      variantIds: ['z1'],
      pending: {
        slot: 'horario',
        options: [{ key: 'k', label: '14:00' }],
        messageId: 'm3',
      },
    })
    const parked = parkFromFrame(f, 'clarify')
    expect(parked.reason).toBe('clarify')
    expect(resumeParkedObligation(parked)?.kind).toBe('choose_slot')
    expect(parked.snapshot.variantIds).toEqual(['z1'])
  })

  it('handoff reason tipado na pilha', () => {
    const parked = parkFromFrame(frame({ serviceId: 'svc' }), 'handoff')
    expect(parked.reason).toBe('handoff')
    expect(resumeParkedObligation(parked)).toBeNull()
  })
})
