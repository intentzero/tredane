/**
 * M7 / #418 — gerador L1 a partir do grafo + CI em duas clínicas.
 * Ficheiro separado de p0-cases / dialogs.test para não conflitar com #416/#417.
 */
import { describe, expect, it } from 'vitest'
import { enumerateGraphDialogPaths, type GraphOccupancy } from './graph-generator'
import { runDialogCase } from './runner'
import { bootDialogScenario } from './scenario'
import { bootSecondClinicScenario } from './second-clinic'

const OCCUPANCIES: GraphOccupancy[] = ['livre', 'ocupado', 'fechado', 'tempo', 'sinal']

describe('gerador de diálogos L1 pelo grafo (#418)', () => {
  it('cenário de referência: enumera percursos com expectativas do grafo', async () => {
    const s = bootDialogScenario()
    try {
      const paths = await enumerateGraphDialogPaths(s.db, s.tenantId, {
        clinicLabel: 'ref',
        clock: s.clock,
      })
      expect(paths.length).toBeGreaterThan(0)
      const kinds = new Set(paths.map((p) => p.occupancy))
      expect(kinds.has('livre')).toBe(true)
      expect(kinds.has('ocupado')).toBe(true)
      expect(kinds.has('fechado')).toBe(true)
      // Peeling (sinal) e Bronzeamento (Tempo) estão no cenário de referência.
      expect(kinds.has('sinal')).toBe(true)
      expect(kinds.has('tempo')).toBe(true)

      for (const p of paths) {
        expect(p.expected.occupancy).toBe(p.occupancy)
        expect(p.expected.durationMinutes).toBeGreaterThan(0)
        expect(p.dialog.turns.length).toBeGreaterThan(0)
        if (p.occupancy === 'livre' || p.occupancy === 'sinal' || p.occupancy === 'tempo') {
          expect(p.expected.slotFree).toBe(true)
          expect(p.expected.dayClosed).toBe(false)
        }
        if (p.occupancy === 'fechado') {
          expect(p.expected.dayClosed).toBe(true)
          expect(p.expected.slotFree).toBe(false)
        }
        if (p.occupancy === 'sinal') expect(p.expected.requiresSignal).toBe(true)
        if (p.occupancy === 'tempo') expect(p.expected.hasTempo).toBe(true)
      }
    } finally {
      s.close()
    }
  })

  it('segunda clínica: configuração diferente também gera percursos', async () => {
    const s = bootSecondClinicScenario()
    try {
      const paths = await enumerateGraphDialogPaths(s.db, s.tenantId, {
        clinicLabel: 'b',
        clock: s.clock,
      })
      expect(paths.length).toBeGreaterThan(0)
      const names = new Set(paths.map((p) => p.serviceName))
      expect(names.has('Massagem')).toBe(true)
      expect(names.has('Depilação a laser') || names.has('Peeling suave')).toBe(true)
      const kinds = new Set(paths.map((p) => p.occupancy))
      expect(kinds.has('livre')).toBe(true)
      expect(kinds.has('fechado')).toBe(true)
      // Sinal fixo no Peeling suave.
      expect(kinds.has('sinal')).toBe(true)
      // Sem bloco Tempo nesta clínica.
      expect(kinds.has('tempo')).toBe(false)
    } finally {
      s.close()
    }
  })

  for (const occupancy of OCCUPANCIES) {
    it(
      `L1 amostra no cenário de referência · ${occupancy}`,
      async () => {
        const probe = bootDialogScenario()
        let dialog
        try {
          const paths = await enumerateGraphDialogPaths(probe.db, probe.tenantId, {
            clinicLabel: 'ref',
            clock: probe.clock,
          })
          // Preferir serviços da matriz com caminho estável (evita aliases / micro sem preço).
          const prefer =
            occupancy === 'sinal'
              ? paths.find((p) => p.occupancy === occupancy && /peeling/i.test(p.serviceName))
              : occupancy === 'tempo'
                ? paths.find((p) => p.occupancy === occupancy && /bronze/i.test(p.serviceName))
                : paths.find(
                    (p) =>
                      p.occupancy === occupancy
                      && (p.serviceName === 'Massagem' || p.serviceName === 'Limpeza de pele'),
                  )
          const path = prefer ?? paths.find((p) => p.occupancy === occupancy)
          expect(path).toBeTruthy()
          dialog = path!.dialog
        } finally {
          probe.close()
        }
        const r = await runDialogCase(dialog!)
        expect(r.ok, r.error).toBe(true)
      },
      30_000,
    )
  }

  it(
    'L1 amostra na segunda clínica · livre',
    async () => {
      const probe = bootSecondClinicScenario()
      let dialog
      try {
        const paths = await enumerateGraphDialogPaths(probe.db, probe.tenantId, {
          clinicLabel: 'b',
          clock: probe.clock,
        })
        const path = paths.find((p) => p.occupancy === 'livre' && p.serviceName === 'Massagem')
        expect(path).toBeTruthy()
        dialog = path!.dialog
      } finally {
        probe.close()
      }
      const r = await runDialogCase(dialog!, bootSecondClinicScenario)
      expect(r.ok, r.error).toBe(true)
    },
    30_000,
  )
})
