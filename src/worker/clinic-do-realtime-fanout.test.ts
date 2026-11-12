/**
 * Garante fanout em tempo real no caminho de clique em escolhas (regressão PR #708).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const CLINIC_DO = resolve(import.meta.dirname, 'clinic-do.ts')

describe('ClinicDurableObject — fanout em cliques de escolha', () => {
  it('não desliga WS realtime no typing ou dispatch de choice click', () => {
    const src = readFileSync(CLINIC_DO, 'utf8')
    const start = src.indexOf('async handleProposalButtonClick(')
    expect(start).toBeGreaterThan(0)
    const nextRpc = src.indexOf('\n  async ', start + 1)
    const block = src.slice(start, nextRpc > start ? nextRpc : start + 12_000)
    const fanoutCalls = [...block.matchAll(/#fanoutOutboxes\([^)]*\)/g)].map((m) => m[0])
    expect(fanoutCalls.length).toBeGreaterThan(0)
    for (const call of fanoutCalls) {
      expect(call).not.toMatch(/,\s*false\s*\)/)
    }
  })

  it('autodraft onTyping mantém fanout ligado', () => {
    const src = readFileSync(CLINIC_DO, 'utf8')
    const typingFanouts = [...src.matchAll(/onTyping:[\s\S]*?#fanoutOutboxes\([^)]*\)/g)]
    expect(typingFanouts.length).toBeGreaterThan(0)
    for (const m of typingFanouts) {
      expect(m[0]).toMatch(/#fanoutOutboxes\([^,]+,\s*\[[^\]]+\],\s*true\)/)
    }
  })
})
