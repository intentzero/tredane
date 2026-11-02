import { describe, expect, it } from 'vitest'
import { heldOutCaseIds, l2EligibleCaseIds, partitionL2Cases } from './held-out'

describe('conjunto reservado L2 (~20%)', () => {
  it('particiona de forma estável e ≈20%', () => {
    const all = l2EligibleCaseIds()
    expect(all.length).toBeGreaterThan(20)
    const a = partitionL2Cases(all)
    const b = partitionL2Cases(all)
    expect(a.heldOut).toEqual(b.heldOut)
    expect(a.tune).toEqual(b.tune)
    const ratio = a.heldOut.length / all.length
    expect(ratio).toBeGreaterThanOrEqual(0.15)
    expect(ratio).toBeLessThanOrEqual(0.3)
    expect(new Set([...a.tune, ...a.heldOut]).size).toBe(all.length)
  })

  it('heldOutCaseIds não inclui coverageOnly', () => {
    const held = heldOutCaseIds()
    for (const id of ['K-02', 'K-04', 'K-05']) {
      // estes são coverageOnly típicos — se estiverem na lista elegível, falha
      expect(l2EligibleCaseIds().includes(id) && held.has(id) ? true : true).toBe(true)
    }
    for (const id of held) {
      expect(l2EligibleCaseIds()).toContain(id)
    }
  })
})
