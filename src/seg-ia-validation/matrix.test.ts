/**
 * S9 (#180): a matriz máquina-legível aponta para ficheiros reais e separa
 * gates de auth/isolamento da qualidade de modelo (H9).
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SEG_IA_EVIDENCE_MATRIX } from './matrix'

const root = join(import.meta.dirname, '../..')

describe('S9: matriz de evidência', () => {
  it('tem ids estáveis e cobre auth vs model_quality vs human_pilot', () => {
    const ids = SEG_IA_EVIDENCE_MATRIX.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('S9-T01')
    expect(ids).toContain('S9-H9')
    expect(ids).toContain('S9-H10')
    expect(ids).toContain('S9-UI')

    const auth = SEG_IA_EVIDENCE_MATRIX.filter((r) => r.gate === 'auth_isolation')
    const model = SEG_IA_EVIDENCE_MATRIX.filter((r) => r.gate === 'model_quality')
    const human = SEG_IA_EVIDENCE_MATRIX.filter((r) => r.gate === 'human_pilot')
    expect(auth.length).toBeGreaterThanOrEqual(4)
    expect(model.every((r) => r.state === 'Em aberto')).toBe(true)
    expect(human.some((r) => r.id === 'S9-H10' && r.state === 'Em aberto')).toBe(true)
    // Qualidade de modelo não mistura com testes de autorização.
    for (const row of model) {
      expect(row.tests).toEqual([])
    }
  })

  it('ficheiros de teste e docs referenciados existem', () => {
    const missing: string[] = []
    for (const row of SEG_IA_EVIDENCE_MATRIX) {
      for (const rel of [...row.tests, ...row.docs]) {
        if (!existsSync(join(root, rel))) missing.push(`${row.id}:${rel}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('gates Confirmado de auth têm pelo menos um teste automatizado', () => {
    for (const row of SEG_IA_EVIDENCE_MATRIX) {
      if (row.state !== 'Confirmado') continue
      if (row.gate === 'model_quality' || row.gate === 'human_pilot') continue
      expect(row.tests.length, row.id).toBeGreaterThan(0)
    }
  })

  it('não declara piloto activado nem AI_AUTOBOOK liberado', () => {
    const h10 = SEG_IA_EVIDENCE_MATRIX.find((r) => r.id === 'S9-H10')
    expect(h10?.state).toBe('Em aberto')
    expect(h10?.notes).toMatch(/NÃO libera/i)
  })
})
