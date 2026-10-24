import { describe, expect, it } from 'vitest'
import {
  areaNavLabel,
  areaTitle,
  panelHref,
  resolvePanelRoute,
} from './routes'

describe('panel routes (#22)', () => {
  it('resolve painel entrar / clinicas / áreas', () => {
    expect(resolvePanelRoute('/entrar')).toEqual({ kind: 'entrar' })
    expect(resolvePanelRoute('/entrar/factor-one')).toEqual({ kind: 'entrar' })
    expect(resolvePanelRoute('/clinicas')).toEqual({ kind: 'clinicas' })
    expect(resolvePanelRoute('/c/clinic-demo-a/conversas')).toEqual({
      kind: 'area',
      area: 'conversas',
      tenantId: 'clinic-demo-a',
    })
    expect(resolvePanelRoute('/c/clinic-demo-a/acompanhamento')).toEqual({
      kind: 'area',
      area: 'acompanhamento',
      tenantId: 'clinic-demo-a',
    })
    expect(resolvePanelRoute('/')).toBeNull()
    expect(resolvePanelRoute('/prova')).toBeNull()
  })

  it('rótulo curto Acompanhar e título Acompanhamento (DEC-045)', () => {
    expect(areaNavLabel('acompanhamento')).toBe('Acompanhar')
    expect(areaTitle('acompanhamento')).toBe('Acompanhamento')
    expect(
      panelHref({
        kind: 'area',
        area: 'clinica',
        tenantId: 'clinic-demo-a',
        section: 'hub',
      }),
    ).toBe('/c/clinic-demo-a/clinica')
  })

  it('resolve sub-rotas de configuração da clínica (#28)', () => {
    expect(resolvePanelRoute('/c/clinic-demo-a/clinica')).toEqual({
      kind: 'area',
      area: 'clinica',
      tenantId: 'clinic-demo-a',
      section: 'hub',
      entityId: undefined,
    })
    expect(resolvePanelRoute('/c/clinic-demo-a/clinica/servicos/novo')).toEqual({
      kind: 'area',
      area: 'clinica',
      tenantId: 'clinic-demo-a',
      section: 'servico',
      entityId: 'novo',
    })
    expect(resolvePanelRoute('/c/clinic-demo-a/clinica/recursos/profissional/pro_1')).toEqual({
      kind: 'area',
      area: 'clinica',
      tenantId: 'clinic-demo-a',
      section: 'profissional',
      entityId: 'pro_1',
    })
    expect(resolvePanelRoute('/c/clinic-demo-a/clinica/horarios')).toEqual({
      kind: 'area',
      area: 'clinica',
      tenantId: 'clinic-demo-a',
      section: 'horarios',
      entityId: undefined,
    })
  })
})
