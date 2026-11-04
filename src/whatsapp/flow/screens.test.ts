import { describe, expect, it } from 'vitest'
import { TODAS_OPTION_KEY } from '../../clinic/ai/choice-offer'
import {
  applyScreenSubmission,
  bookableServices,
  nextFlowScreen,
  resolveVariantIds,
  revalidateFlowFrameAgainstCatalog,
  type FlowCatalogService,
} from './screens'

const depilacao: FlowCatalogService = {
  id: 'svc_dep',
  name: 'Depilação',
  active: true,
  zones: [
    {
      id: 'z_ax_f',
      name: 'Axila',
      audience: 'feminino',
      active: true,
      durationMinutes: 15,
    },
    {
      id: 'z_pe_f',
      name: 'Pernas',
      audience: 'feminino',
      active: true,
      durationMinutes: 40,
    },
    {
      id: 'z_ax_m',
      name: 'Axila',
      audience: 'masculino',
      active: true,
      durationMinutes: 20,
    },
  ],
}

const limpeza: FlowCatalogService = {
  id: 'svc_limp',
  name: 'Limpeza de pele',
  active: true,
  zones: [],
}

describe('whatsapp flow screens (ADR-0016 §3)', () => {
  it('salta SERVICO quando há um só agendável', () => {
    const next = nextFlowScreen({
      catalog: [depilacao],
      frame: { serviceId: null, line: null, variantIds: null, slotKey: null },
    })
    expect(next).toMatchObject({ screen: 'GENERO' })
  })

  it('pede GENERO só com dois sexos; depois VARIANTES com Checkbox + Todas', () => {
    const afterGender = applyScreenSubmission(
      [depilacao],
      { serviceId: 'svc_dep', line: null, variantIds: null, slotKey: null },
      'GENERO',
      { gender_id: 'feminino' },
    )
    expect(afterGender.ok).toBe(true)
    if (!afterGender.ok) return
    const next = nextFlowScreen({ catalog: [depilacao], frame: afterGender.frame })
    expect(next).toMatchObject({ screen: 'VARIANTES' })
    if (!('screen' in next)) return
    const variants = next.data.variants as Array<{ id: string }>
    expect(variants.map((v) => v.id)).toEqual(['z_ax_f', 'z_pe_f', TODAS_OPTION_KEY])
  })

  it('todas resolve para todas as variantes da linha', () => {
    const ids = resolveVariantIds(depilacao, 'feminino', [TODAS_OPTION_KEY, 'z_ax_f'])
    expect(ids).toEqual(['z_ax_f', 'z_pe_f'])
  })

  it('sem variantes vai a HORARIO (serviço linha única)', () => {
    const next = nextFlowScreen({
      catalog: [limpeza],
      frame: { serviceId: 'svc_limp', line: null, variantIds: null, slotKey: null },
      slots: [{ id: '2026-11-05T10:00', date: '2026-11-05', time: '10:00' }],
    })
    expect(next).toMatchObject({ screen: 'HORARIO' })
    if (!('screen' in next)) return
    const slots = next.data.slots as Array<{ id: string; title: string }>
    expect(slots[0]?.id).toBe('2026-11-05T10:00')
    expect(slots[0]?.title).toMatch(/quinta/)
  })

  it('mais de 19 variantes → chat_fallback', () => {
    const many: FlowCatalogService = {
      id: 'svc_many',
      name: 'Muitas',
      active: true,
      zones: Array.from({ length: 20 }, (_, i) => ({
        id: `z${i}`,
        name: `Z${i}`,
        audience: 'ambos',
        active: true,
        durationMinutes: 10,
      })),
    }
    const next = nextFlowScreen({
      catalog: [many],
      frame: { serviceId: 'svc_many', line: null, variantIds: null, slotKey: null },
    })
    expect(next).toEqual({ kind: 'chat_fallback', reason: 'too_many_variants' })
  })

  it('quadro completo → ready (proposta no chat)', () => {
    const next = nextFlowScreen({
      catalog: [limpeza],
      frame: {
        serviceId: 'svc_limp',
        line: null,
        variantIds: null,
        slotKey: '2026-11-05T10:00',
      },
    })
    expect(next).toEqual({ kind: 'ready' })
  })

  // T05 / #536 — membership de slot na lista oferecida.
  it('T05: slot_id ∈ lista oferecida → ok', () => {
    const offered = [
      { id: '2026-11-05T10:00', date: '2026-11-05', time: '10:00' },
      { id: '2026-11-05T11:00', date: '2026-11-05', time: '11:00' },
    ]
    const applied = applyScreenSubmission(
      [limpeza],
      { serviceId: 'svc_limp', line: null, variantIds: null, slotKey: null },
      'HORARIO',
      { slot_id: '2026-11-05T10:00' },
      { offeredSlots: offered },
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.frame.slotKey).toBe('2026-11-05T10:00')
  })

  // T06 / #536 — regex válida mas id não oferecido.
  it('T06: slot civil válido mas fora da lista → error_message', () => {
    const offered = [{ id: '2026-11-05T10:00', date: '2026-11-05', time: '10:00' }]
    const applied = applyScreenSubmission(
      [limpeza],
      { serviceId: 'svc_limp', line: null, variantIds: null, slotKey: null },
      'HORARIO',
      { slot_id: '2026-11-05T17:00' },
      { offeredSlots: offered },
    )
    expect(applied.ok).toBe(false)
    if (applied.ok) return
    expect(applied.errorMessage).toMatch(/já não está livre|Escolha outro/i)
    expect(applied.frame.slotKey).toBeNull()
  })

  // T07 / #539 — catalogVersion diverge → limpa ids mortos.
  it('T07: revalidateFlowFrameAgainstCatalog limpa serviço morto', () => {
    const result = revalidateFlowFrameAgainstCatalog(
      {
        serviceId: 'svc_gone',
        line: 'feminino',
        variantIds: ['z1'],
        slotKey: '2026-11-05T10:00',
      },
      [depilacao],
    )
    expect(result.frame.serviceId).toBeNull()
    expect(result.cleared).toContain('serviceId')
    expect(result.cleared).toContain('slotKey')
  })

  it('T07b: variante morta é limpa sem inventar substituto', () => {
    const result = revalidateFlowFrameAgainstCatalog(
      {
        serviceId: 'svc_dep',
        line: 'feminino',
        variantIds: ['z_ax_f', 'z_dead'],
        slotKey: '2026-11-05T10:00',
      },
      [depilacao],
    )
    expect(result.frame.variantIds).toEqual(['z_ax_f'])
    expect(result.cleared).toContain('variantIds')
    expect(result.frame.slotKey).toBeNull()
  })

  // T13 / #537 — sessão do token vazia não salta para HORARIO.
  it('T13: snapshot vazio do token → SERVICO (não herda frame stale)', () => {
    const next = nextFlowScreen({
      catalog: [depilacao, limpeza],
      frame: { serviceId: null, line: null, variantIds: null, slotKey: null },
      slots: [{ id: '2026-11-05T10:00', date: '2026-11-05', time: '10:00' }],
    })
    expect(next).toMatchObject({ screen: 'SERVICO' })
  })

  // Schema do Flow JSON publicado (staging): só estas chaves por ecrã.
  // Extra (title/layout/footer) ou omissão de error_message → Meta
  // payload-schema-error / «Something went wrong».
  it('data de cada ecrã só tem chaves do schema publicado + error_message', () => {
    const schema: Record<string, string[]> = {
      SERVICO: ['body', 'services', 'error_message'],
      GENERO: ['body', 'genders', 'error_message'],
      VARIANTES: ['body', 'variants', 'error_message'],
      HORARIO: ['body', 'slots', 'error_message'],
    }
    const cases = [
      nextFlowScreen({
        catalog: [depilacao, limpeza],
        frame: { serviceId: null, line: null, variantIds: null, slotKey: null },
      }),
      nextFlowScreen({
        catalog: [depilacao],
        frame: { serviceId: 'svc_dep', line: null, variantIds: null, slotKey: null },
      }),
      nextFlowScreen({
        catalog: [depilacao],
        frame: {
          serviceId: 'svc_dep',
          line: 'feminino',
          variantIds: null,
          slotKey: null,
        },
      }),
      nextFlowScreen({
        catalog: [limpeza],
        frame: { serviceId: 'svc_limp', line: null, variantIds: null, slotKey: null },
        slots: [{ id: '2026-11-05T10:00', date: '2026-11-05', time: '10:00' }],
      }),
    ]
    for (const next of cases) {
      expect(next).toHaveProperty('screen')
      if (!('screen' in next)) return
      const allowed = schema[next.screen]
      expect(allowed).toBeDefined()
      expect(Object.keys(next.data).sort()).toEqual([...(allowed ?? [])].sort())
      expect(next.data.error_message).toBe('')
    }
  })

  it('Paulo path: serviço+linha sem variantes → VARIANTES (schema limpo)', () => {
    const next = nextFlowScreen({
      catalog: [depilacao],
      frame: {
        serviceId: 'svc_dep',
        line: 'feminino',
        variantIds: null,
        slotKey: null,
      },
    })
    expect(next).toMatchObject({ screen: 'VARIANTES' })
    if (!('screen' in next)) return
    expect(Object.keys(next.data).sort()).toEqual([
      'body',
      'error_message',
      'variants',
    ])
  })

  // T14 / #540 — zonas todas inactivas → não bookable.
  it('T14: serviço com zonas todas inactivas não é bookable', () => {
    const dead: FlowCatalogService = {
      id: 'svc_dead',
      name: 'Laser',
      active: true,
      zones: [
        {
          id: 'z1',
          name: 'Rosto',
          audience: 'ambos',
          active: false,
          durationMinutes: 30,
        },
      ],
    }
    expect(bookableServices([dead, limpeza]).map((s) => s.id)).toEqual(['svc_limp'])
    const next = nextFlowScreen({
      catalog: [dead],
      frame: { serviceId: null, line: null, variantIds: null, slotKey: null },
    })
    expect(next).toEqual({ kind: 'chat_fallback', reason: 'no_bookable_services' })
  })
})
