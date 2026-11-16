import { describe, expect, it } from 'vitest'
import { computeConversationMetrics } from './compute'
import type { ConversationQualityEpisodeRow, ConversationMetricsWindow } from './types'

const window: ConversationMetricsWindow = {
  tenantId: 'clinic-a',
  fromMs: 0,
  toMs: 1_000_000,
}

function ep(
  partial: Partial<ConversationQualityEpisodeRow> & Pick<ConversationQualityEpisodeRow, 'sessionId'>,
): ConversationQualityEpisodeRow {
  return {
    tenantId: 'clinic-a',
    conversationId: 'c1',
    openedAt: 1000,
    closedAt: 2000,
    lastMessageAt: 1500,
    outcome: null,
    dropStep: 'slot_offer',
    maxStep: 'proposal',
    inboundTurns: 5,
    inboundTurnsToConfirm: null,
    confirmedAppointmentId: null,
    bookingIntent: true,
    misunderstandingTurns: 0,
    attendantSpontaneous: 0,
    attendantOfferedRule: 0,
    attendantRecognized: 0,
    attendantRegistered: 0,
    attendantLastStep: null,
    handoffUnattended: false,
    falseConfirmation: false,
    aiAppointmentFulfillment: null,
    expiresAt: 9_999_999,
    ...partial,
  }
}

describe('computeConversationMetrics', () => {
  it('booking rate: confirmados / intenção', () => {
    const report = computeConversationMetrics(
      [
        ep({
          sessionId: 's1',
          outcome: 'agendado',
          confirmedAppointmentId: 'apt1',
          inboundTurnsToConfirm: 6,
        }),
        ep({ sessionId: 's2', outcome: 'abandon' }),
        ep({ sessionId: 's3', outcome: 'handoff' }),
      ],
      [],
      window,
      500_000,
    )
    expect(report.bookingRate.episodesWithIntent).toBe(3)
    expect(report.bookingRate.confirmed).toBe(1)
    expect(report.bookingRate.rate).toBeCloseTo(1 / 3)
  })

  it('red line: conta false confirmations', () => {
    const report = computeConversationMetrics([], ['cfc_1', 'cfc_2'], window, 500_000)
    expect(report.falseConfirmations.count).toBe(2)
  })

  it('attendant calls: split e taxas de reconhecimento/registo', () => {
    const report = computeConversationMetrics(
      [
        ep({
          sessionId: 's1',
          attendantSpontaneous: 1,
          attendantRecognized: 1,
          attendantRegistered: 0,
          attendantLastStep: 'proposal',
        }),
        ep({
          sessionId: 's2',
          attendantOfferedRule: 1,
          attendantRecognized: 1,
          attendantRegistered: 1,
          attendantLastStep: 'slot_offer',
        }),
      ],
      [],
      window,
      500_000,
    )
    expect(report.attendantCalls.episodesWithRequest).toBe(2)
    expect(report.attendantCalls.spontaneous).toBe(1)
    expect(report.attendantCalls.offeredByMisunderstandingRule).toBe(1)
    expect(report.attendantCalls.recognitionRate).toBe(1)
    expect(report.attendantCalls.registrationRate).toBe(0.5)
    expect(report.attendantCalls.stepBreakdown.proposal).toBe(1)
  })

  it('abandono 24h sem compromisso nem handoff atendido', () => {
    const now = 100_000
    const report = computeConversationMetrics(
      [
        ep({
          sessionId: 's1',
          lastMessageAt: now - 25 * 60 * 60 * 1000,
          outcome: 'abandon',
          dropStep: 'confirm',
        }),
        ep({
          sessionId: 's2',
          lastMessageAt: now - 25 * 60 * 60 * 1000,
          outcome: 'agendado',
          confirmedAppointmentId: 'apt',
        }),
        ep({
          sessionId: 's3',
          lastMessageAt: now - 1 * 60 * 60 * 1000,
        }),
      ],
      [],
      window,
      now,
    )
    expect(report.abandonedConversations.count).toBe(1)
    expect(report.abandonedConversations.stepBreakdown.confirm).toBe(1)
  })

  it('messages to book: mediana vs baseline 6', () => {
    const report = computeConversationMetrics(
      [
        ep({ sessionId: 's1', outcome: 'agendado', confirmedAppointmentId: 'a', inboundTurnsToConfirm: 3 }),
        ep({ sessionId: 's2', outcome: 'agendado', confirmedAppointmentId: 'b', inboundTurnsToConfirm: 9 }),
      ],
      [],
      window,
      500_000,
    )
    expect(report.messagesToBook.median).toBe(6)
    expect(report.messagesToBook.baseline).toBe(6)
  })

  it('misunderstandings per conversation', () => {
    const report = computeConversationMetrics(
      [ep({ sessionId: 's1', misunderstandingTurns: 4 }), ep({ sessionId: 's2', misunderstandingTurns: 2 })],
      [],
      window,
      500_000,
    )
    expect(report.misunderstandingsPerConversation.mean).toBe(3)
    expect(report.misunderstandingsPerConversation.totalTurns).toBe(6)
  })

  it('attendance IA: fulfilled/cancelled/no_show', () => {
    const report = computeConversationMetrics(
      [
        ep({
          sessionId: 's1',
          confirmedAppointmentId: 'a',
          aiAppointmentFulfillment: 'fulfilled',
        }),
        ep({
          sessionId: 's2',
          confirmedAppointmentId: 'b',
          aiAppointmentFulfillment: 'no_show',
        }),
        ep({
          sessionId: 's3',
          confirmedAppointmentId: 'c',
          aiAppointmentFulfillment: 'pending',
        }),
      ],
      [],
      window,
      500_000,
    )
    expect(report.attendance.aiBooked).toBe(3)
    expect(report.attendance.fulfilled).toBe(1)
    expect(report.attendance.noShow).toBe(1)
    expect(report.attendance.pending).toBe(1)
    expect(report.attendance.fulfillmentRate).toBe(0.5)
  })
})