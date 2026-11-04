import { describe, expect, it } from 'vitest'
import { TODAS_OPTION_KEY } from '../../clinic/ai/choice-offer'
import {
  applyScreenSubmission,
  nextFlowScreen,
  resolveVariantIds,
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
})
