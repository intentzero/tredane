import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { forbiddenClientTermsIn } from '../../clinic/ai/client-copy'
import { FLOW_COPY } from './copy'
import {
  applyScreenSubmission,
  bookableServices,
  entryFlowScreen,
  FLOW_ENTRY_SCREEN,
  flowVisitTotalLine,
  formatFlowBrl,
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
      priceCents: 8_000,
    },
    {
      id: 'z_pe_f',
      name: 'Pernas',
      audience: 'feminino',
      active: true,
      durationMinutes: 40,
      priceCents: 12_000,
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

  it('pede GENERO só com dois sexos; VARIANTES traz preço e não traz Todas', () => {
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
    const variants = next.data.variants as Array<{ id: string; title: string; description: string }>
    expect(variants.map((v) => v.id)).toEqual(['z_ax_f', 'z_pe_f'])
    expect(variants.map((v) => v.id)).not.toContain('todas')
    expect(variants[0]).toEqual({
      id: 'z_ax_f',
      title: 'Axila · R$ 80,00',
      description: '',
    })
    expect(variants[1]?.title).toBe('Pernas · R$ 120,00')
    expect(next.data.body).not.toMatch(/Todas/)
  })

  it('id todas não vira variante e não se grava', () => {
    const ids = resolveVariantIds(depilacao, 'feminino', ['todas', 'z_ax_f'])
    expect(ids).toEqual(['z_ax_f'])
    const applied = applyScreenSubmission(
      [depilacao],
      { serviceId: 'svc_dep', line: 'feminino', variantIds: null, slotKey: null },
      'VARIANTES',
      { variant_ids: ['todas'] },
    )
    expect(applied.ok).toBe(false)
    if (applied.ok) return
    expect(applied.frame.variantIds).toBeNull()
  })

  it('nome longo: preço vai na descrição, título fica em 30', () => {
    const long: FlowCatalogService = {
      id: 'svc_long',
      name: 'Laser',
      active: true,
      zones: [
        {
          id: 'z_long',
          name: 'Limpeza profunda do rosto inteiro',
          audience: 'ambos',
          active: true,
          durationMinutes: 30,
          priceCents: 80_000,
        },
      ],
    }
    const next = nextFlowScreen({
      catalog: [long],
      frame: { serviceId: 'svc_long', line: null, variantIds: null, slotKey: null },
    })
    expect(next).toMatchObject({ screen: 'VARIANTES' })
    if (!('screen' in next)) return
    const row = (next.data.variants as Array<{ title: string; description: string }>)[0]!
    expect(row.title.length).toBeLessThanOrEqual(30)
    expect(row.description).toContain('R$ 800,00')
    expect(row.description).toContain('Limpeza profunda do rosto inteiro')
    expect(row.title + row.description).not.toMatch(/America\//)
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
    expect(next.data.body).toBe(FLOW_COPY.slotBody)
  })

  it('HORARIO mostra o total cotado, sem fuso IANA', () => {
    const total = flowVisitTotalLine({ priceCents: 16_000, comboName: 'Axila e pernas' })
    expect(total).toBe('Total: R$ 160,00 (combo Axila e pernas)')
    expect(formatFlowBrl(80_000)).toBe('R$ 800,00')
    const next = nextFlowScreen({
      catalog: [limpeza],
      frame: { serviceId: 'svc_limp', line: null, variantIds: null, slotKey: null },
      slots: [{ id: '2026-11-05T10:00', date: '2026-11-05', time: '10:00' }],
      visitTotalLine: total,
    })
    expect(next).toMatchObject({ screen: 'HORARIO' })
    if (!('screen' in next)) return
    expect(next.data.body).toBe(`${FLOW_COPY.slotBody}\n${total}`)
    expect(String(next.data.body)).not.toMatch(/America\//)
  })

  it('20 variantes cabem; 21 → chat_fallback', () => {
    const many = (n: number): FlowCatalogService => ({
      id: 'svc_many',
      name: 'Muitas',
      active: true,
      zones: Array.from({ length: n }, (_, i) => ({
        id: `z${i}`,
        name: `Z${i}`,
        audience: 'ambos',
        active: true,
        durationMinutes: 10,
        priceCents: 1_000,
      })),
    })
    const frame = { serviceId: 'svc_many', line: null, variantIds: null, slotKey: null }
    const ok = nextFlowScreen({ catalog: [many(20)], frame })
    expect(ok).toMatchObject({ screen: 'VARIANTES' })
    if ('screen' in ok) {
      expect((ok.data.variants as unknown[]).length).toBe(20)
    }
    const over = nextFlowScreen({ catalog: [many(21)], frame })
    expect(over).toEqual({ kind: 'chat_fallback', reason: 'too_many_variants' })
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

  // Chaves de `booking-flow.json` (a republicar). Extra ou omissão →
  // payload-schema-error. O JSON que está na Meta antes desta revisão
  // não tem `service_init` nem `description`.
  it('data de cada ecrã só tem chaves do schema publicado + error_message', () => {
    const schema: Record<string, string[]> = {
      HUB: ['body', 'actions', 'error_message'],
      SERVICO: ['body', 'services', 'service_init', 'error_message'],
      GENERO: ['body', 'genders', 'error_message'],
      VARIANTES: ['body', 'variants', 'error_message'],
      HORARIO: ['body', 'slots', 'error_message'],
    }
    const hubEntry = entryFlowScreen({
      catalog: [depilacao],
      frame: { serviceId: null, line: null, variantIds: null, slotKey: null },
    })
    expect(hubEntry).toMatchObject({ screen: 'HUB' })
    if ('screen' in hubEntry) {
      expect(Object.keys(hubEntry.data).sort()).toEqual([...schema.HUB!].sort())
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

  it('entryFlowScreen: INIT pousa só em HUB (mesmo com serviço na sessão)', () => {
    expect(FLOW_ENTRY_SCREEN).toBe('HUB')
    const known = {
      serviceId: 'svc_dep',
      line: 'feminino' as const,
      variantIds: ['z_ax_f'],
      slotKey: null,
    }
    const entry = entryFlowScreen({ catalog: [depilacao, limpeza], frame: known })
    expect(entry).toMatchObject({ screen: 'HUB' })
    if (!('screen' in entry)) return
    expect(Object.keys(entry.data).sort()).toEqual([
      'actions',
      'body',
      'error_message',
    ])
    const actions = entry.data.actions as Array<{ id: string; title: string }>
    expect(actions.map((a) => a.id)).toEqual([
      'agendar',
      'remarcar',
      'cancelar',
      'meus',
      'informacoes',
      'equipe',
    ])
    expect(actions.map((a) => a.title)).toEqual([
      'Agendar',
      'Remarcar',
      'Cancelar',
      'Meus agendamentos',
      'Informações',
      'Falar com a equipe',
    ])
    expect(entry.data.body).toBe(FLOW_COPY.hubBody)
  })

  it('INIT HUB abre mesmo sem serviços agendáveis (Remarcar/Cancelar/Meus)', () => {
    const entry = entryFlowScreen({
      catalog: [],
      frame: { serviceId: null, line: null, variantIds: null, slotKey: null },
    })
    expect(entry).toMatchObject({ screen: 'HUB' })
  })

  it('HUB Agendar → applyScreenSubmission devolve hubAction; nextFlowScreen segue ADR', () => {
    const applied = applyScreenSubmission(
      [depilacao],
      { serviceId: null, line: null, variantIds: null, slotKey: null },
      'HUB',
      { hub_action: 'agendar' },
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.hubAction).toBe('agendar')
    const next = nextFlowScreen({ catalog: [depilacao], frame: applied.frame })
    expect(next).toMatchObject({ screen: 'GENERO' })
  })

  it('HUB Agendar limpa slotKey stale — não SUCCESS sem HORARIO (C16 gating)', () => {
    const applied = applyScreenSubmission(
      [depilacao],
      {
        serviceId: 'svc_dep',
        line: 'feminino',
        variantIds: ['z1'],
        slotKey: '2026-11-05T17:00',
      },
      'HUB',
      { hub_action: 'agendar' },
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.hubAction).toBe('agendar')
    expect(applied.frame.slotKey).toBeNull()
    expect(applied.frame.serviceId).toBe('svc_dep')
    expect(applied.frame.line).toBe('feminino')
    // Sem slot: next pede VARIANTES/HORARIO — nunca ready imediato.
    const next = nextFlowScreen({
      catalog: [depilacao],
      frame: applied.frame,
      slots: [{ id: '2026-11-05T17:00', date: '2026-11-05', time: '17:00' }],
    })
    expect(next).not.toEqual({ kind: 'ready' })
    expect('screen' in next ? next.screen : null).not.toBe('SUCCESS')
  })

  it('HUB stubs → hubAction (SUCCESS no endpoint)', () => {
    for (const action of [
      'remarcar',
      'cancelar',
      'meus',
      'informacoes',
      'equipe',
    ] as const) {
      const applied = applyScreenSubmission(
        [depilacao],
        { serviceId: null, line: null, variantIds: null, slotKey: null },
        'HUB',
        { hub_action: action },
      )
      expect(applied.ok).toBe(true)
      if (!applied.ok) return
      expect(applied.hubAction).toBe(action)
    }
  })

  it('SERVICO vazio com serviço inequívoco avança; o mesmo id mantém a linha', () => {
    const only = applyScreenSubmission(
      [limpeza],
      { serviceId: null, line: null, variantIds: null, slotKey: null },
      'SERVICO',
      {},
    )
    expect(only.ok).toBe(true)
    if (!only.ok) return
    expect(only.frame.serviceId).toBe('svc_limp')

    const knownEmpty = applyScreenSubmission(
      [depilacao, limpeza],
      {
        serviceId: 'svc_dep',
        line: 'feminino',
        variantIds: ['z_ax_f'],
        slotKey: null,
      },
      'SERVICO',
      {},
    )
    expect(knownEmpty.ok).toBe(true)
    if (!knownEmpty.ok) return
    expect(knownEmpty.frame.serviceId).toBe('svc_dep')
    expect(knownEmpty.frame.line).toBe('feminino')
    expect(knownEmpty.frame.variantIds).toEqual(['z_ax_f'])

    const kept = applyScreenSubmission(
      [depilacao, limpeza],
      {
        serviceId: 'svc_dep',
        line: 'feminino',
        variantIds: ['z_ax_f'],
        slotKey: null,
      },
      'SERVICO',
      { service_id: 'svc_dep' },
    )
    expect(kept.ok).toBe(true)
    if (!kept.ok) return
    expect(kept.frame.line).toBe('feminino')
    expect(kept.frame.variantIds).toEqual(['z_ax_f'])

    const changed = applyScreenSubmission(
      [depilacao, limpeza],
      {
        serviceId: 'svc_dep',
        line: 'feminino',
        variantIds: ['z_ax_f'],
        slotKey: '2026-11-05T10:00',
      },
      'SERVICO',
      { service_id: 'svc_limp' },
    )
    expect(changed.ok).toBe(true)
    if (!changed.ok) return
    expect(changed.frame).toMatchObject({
      serviceId: 'svc_limp',
      line: null,
      variantIds: null,
      slotKey: null,
    })
  })

  it('copy nova não leva jargão INV-05 nem IANA', () => {
    // «Agendar» no HUB é Confirmado (Paulo 04/11/2026) — excepção explícita ao INV-05 do painel.
    const samples = [
      FLOW_COPY.openBody,
      FLOW_COPY.flowCta,
      FLOW_COPY.hubBody,
      FLOW_COPY.hubRemarcar,
      FLOW_COPY.hubCancelar,
      FLOW_COPY.hubMeus,
      FLOW_COPY.hubInformacoes,
      FLOW_COPY.hubEquipe,
      FLOW_COPY.hubMeusNone,
      FLOW_COPY.hubMeusList(1, 'Depilação terça 05/11 às 10:00'),
      FLOW_COPY.serviceBody,
      FLOW_COPY.serviceBodyReady('Depilação', true),
      FLOW_COPY.serviceBodyReady('Depilação', false),
      FLOW_COPY.variantsBody,
      FLOW_COPY.preparingProposal,
      FLOW_COPY.proposalBuildFailed,
      FLOW_COPY.flowClosedContinue,
      flowVisitTotalLine({ priceCents: 16_000, comboName: null })!,
    ]
    for (const text of samples) {
      expect(forbiddenClientTermsIn(text), text).toEqual([])
      expect(text).not.toMatch(/America\//)
      expect(text).not.toMatch(/\bTodas\b/)
    }
    expect(FLOW_COPY.hubAgendar).toBe('Agendar')
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

describe('booking-flow.json (contrato a republicar na Meta)', () => {
  const flowJson = JSON.parse(
    readFileSync(new URL('./booking-flow.json', import.meta.url), 'utf8'),
  ) as {
    version: string
    routing_model: Record<string, string[]>
    screens: Array<{
      id: string
      data: Record<string, { items?: { properties?: Record<string, unknown> } }>
      layout: { children: Array<{ children?: Array<Record<string, unknown>>; type?: string } & Record<string, unknown>> }
    }>
  }

  function screen(id: string) {
    const found = flowJson.screens.find((s) => s.id === id)
    if (!found) throw new Error(id)
    return found
  }

  function component(id: string, type: string): Record<string, unknown> {
    const walk = (nodes: Array<Record<string, unknown>>): Record<string, unknown> | null => {
      for (const node of nodes) {
        if (node.type === type) return node
        const children = node.children
        if (Array.isArray(children)) {
          const hit = walk(children as Array<Record<string, unknown>>)
          if (hit) return hit
        }
      }
      return null
    }
    const hit = walk(screen(id).layout.children as Array<Record<string, unknown>>)
    if (!hit) throw new Error(`${id} ${type}`)
    return hit
  }

  it('só HUB é entry; SERVICO vem do hub; VARIANTES não volta a si', () => {
    const inbound = new Set(Object.values(flowJson.routing_model).flat())
    const entries = Object.keys(flowJson.routing_model).filter((id) => !inbound.has(id))
    expect(entries).toEqual(['HUB'])
    expect(flowJson.routing_model.HUB).toEqual(['SERVICO'])
    expect(flowJson.routing_model.VARIANTES).toEqual(['HORARIO'])
    expect(flowJson.version).toBe('7.3')
  })

  it('HUB tem RadioButtonsGroup hub_action; SERVICO pré-seleciona por service_init', () => {
    expect(Object.keys(screen('HUB').data).sort()).toEqual([
      'actions',
      'body',
      'error_message',
    ])
    const hubRadio = component('HUB', 'RadioButtonsGroup')
    expect(hubRadio.name).toBe('hub_action')
    expect(hubRadio['data-source']).toBe('${data.actions}')
    const dropdown = component('SERVICO', 'Dropdown')
    expect(dropdown['init-value']).toBeUndefined()
    expect(component('SERVICO', 'Form')['init-values']).toEqual({
      service_id: '${data.service_init}',
    })
    expect(Object.keys(screen('SERVICO').data).sort()).toEqual([
      'body',
      'error_message',
      'service_init',
      'services',
    ])
    const variantProps = screen('VARIANTES').data.variants?.items?.properties
    expect(Object.keys(variantProps ?? {}).sort()).toEqual(['description', 'id', 'title'])
    const checkbox = component('VARIANTES', 'CheckboxGroup')
    expect(checkbox['on-select-action']).toBeUndefined()
    const example = JSON.stringify(screen('VARIANTES').data)
    expect(example).not.toMatch(/"todas"/)
    expect(example).not.toMatch(/Todas escolhe/)
  })
})
