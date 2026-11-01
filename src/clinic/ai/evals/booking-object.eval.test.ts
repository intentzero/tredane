/**
 * Avaliação de referência — identificação do objecto de marcação.
 * Corre sobre fixtures sintéticas; classifica falhas sem PII.
 */
import { describe, expect, it } from 'vitest'
import { resolveBookingObject, type BookingMatchResult } from '../booking-object'
import { EVAL_BOOKING_CATALOG } from './booking-object-catalog'
import { BOOKING_OBJECT_FIXTURES, type EvalFixture } from './booking-object-fixtures'

function runFixture(fixture: EvalFixture): BookingMatchResult {
  let last: BookingMatchResult | null = null
  for (const turn of fixture.turns) {
    last = resolveBookingObject({
      text: turn.text,
      services: EVAL_BOOKING_CATALOG,
      session: turn.sessionBefore ?? null,
      offeredKeys: turn.offeredKeys ?? null,
      catalogDrift: turn.catalogDrift ?? false,
    })
  }
  if (!last) throw new Error(`fixture ${fixture.id} sem turnos`)
  return last
}

function assertExpected(fixture: EvalFixture, result: BookingMatchResult): string[] {
  const problems: string[] = []
  if (result.kind !== fixture.expect.kind) {
    problems.push(`kind: got ${result.kind}, want ${fixture.expect.kind}`)
  }
  if (fixture.expect.serviceId !== undefined && result.serviceId !== fixture.expect.serviceId) {
    problems.push(`serviceId: got ${result.serviceId}, want ${fixture.expect.serviceId}`)
  }
  if (fixture.expect.variantIds) {
    const got = [...result.variantIds].sort().join(',')
    const want = [...fixture.expect.variantIds].sort().join(',')
    if (got !== want) problems.push(`variantIds: got [${got}], want [${want}]`)
  }
  if (fixture.expect.handoffReason && result.handoffReason !== fixture.expect.handoffReason) {
    problems.push(
      `handoffReason: got ${result.handoffReason}, want ${fixture.expect.handoffReason}`,
    )
  }
  if (fixture.expect.questionIncludes && fixture.expect.questionIncludes.length > 0) {
    const q = (result.question ?? '').toLocaleLowerCase('pt-BR')
    const hit = fixture.expect.questionIncludes.some((frag) =>
      q.includes(frag.toLocaleLowerCase('pt-BR')),
    )
    if (!hit) {
      problems.push(
        `question missing any of [${fixture.expect.questionIncludes.join(' | ')}]; got «${result.question}»`,
      )
    }
  }
  return problems
}

describe('eval booking-object (~30 conversas fictícias)', () => {
  it('tem pelo menos 30 fixtures', () => {
    expect(BOOKING_OBJECT_FIXTURES.length).toBeGreaterThanOrEqual(30)
  })

  it('passa o conjunto de referência e reporta falhas classificadas', () => {
    const failures: Array<{
      id: string
      title: string
      class: EvalFixture['failureClassIfMiss']
      problems: string[]
      kind: BookingMatchResult['kind']
    }> = []

    for (const fixture of BOOKING_OBJECT_FIXTURES) {
      const result = runFixture(fixture)
      const problems = assertExpected(fixture, result)
      if (problems.length > 0) {
        failures.push({
          id: fixture.id,
          title: fixture.title,
          class: fixture.failureClassIfMiss,
          problems,
          kind: result.kind,
        })
      }
    }

    if (failures.length > 0) {
      const byClass = failures.reduce<Record<string, number>>((acc, f) => {
        acc[f.class] = (acc[f.class] ?? 0) + 1
        return acc
      }, {})
      const detail = failures
        .map((f) => `- ${f.id} [${f.class}] ${f.title}: ${f.problems.join('; ')}`)
        .join('\n')
      expect.fail(
        `${failures.length}/${BOOKING_OBJECT_FIXTURES.length} falharam. ` +
          `Por classe: ${JSON.stringify(byClass)}\n${detail}`,
      )
    }
  })
})
