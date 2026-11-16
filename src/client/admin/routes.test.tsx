import { afterEach, describe, expect, it } from 'vitest'
import {
  isAdminPath,
  rememberAdminReturn,
  resolveAdminRoute,
  takeAdminReturn,
} from './routes'

describe('admin routes (#828)', () => {
  afterEach(() => window.sessionStorage.clear())

  it('reconhece só /admin e sub-rotas', () => {
    expect(isAdminPath('/admin')).toBe(true)
    expect(isAdminPath('/admin/')).toBe(true)
    expect(isAdminPath('/admin/clinicas')).toBe(true)
    expect(isAdminPath('/administrador')).toBe(false)
    expect(isAdminPath('/clinicas')).toBe(false)
    expect(isAdminPath('/c/clinic-a/admin')).toBe(false)
  })

  it('resolve as cinco áreas e trata o resto como not-found', () => {
    expect(resolveAdminRoute('/admin')).toEqual({ kind: 'area', area: 'visao-geral' })
    expect(resolveAdminRoute('/admin/clinicas/')).toEqual({ kind: 'area', area: 'clinicas' })
    expect(resolveAdminRoute('/admin/suporte')).toEqual({ kind: 'area', area: 'suporte' })
    expect(resolveAdminRoute('/admin/saude')).toEqual({ kind: 'area', area: 'saude' })
    expect(resolveAdminRoute('/admin/qualidade-ia')).toEqual({ kind: 'area', area: 'qualidade-ia' })
    expect(resolveAdminRoute('/admin/nao-existe')).toEqual({ kind: 'not-found' })
    expect(resolveAdminRoute('/clinicas')).toBeNull()
  })

  it('guarda o retorno só para caminhos /admin', () => {
    rememberAdminReturn('/clinicas')
    expect(takeAdminReturn()).toBeNull()
    rememberAdminReturn('/admin/saude')
    expect(takeAdminReturn()).toBe('/admin/saude')
    expect(takeAdminReturn()).toBeNull()
  })
})
