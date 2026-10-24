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
    expect(panelHref({ kind: 'area', area: 'clinica', tenantId: 'clinic-demo-a' })).toBe(
      '/c/clinic-demo-a/clinica',
    )
  })
})
