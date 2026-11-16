import { afterEach, describe, expect, it } from 'vitest'
import {
  clinicaHref,
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

  it('resolve o detalhe da clínica e a aba na URL', () => {
    expect(resolveAdminRoute('/admin/clinicas/clinic-a')).toEqual({ kind: 'clinica', tenantId: 'clinic-a', tab: 'resumo' })
    expect(resolveAdminRoute('/admin/clinicas/clinic-a/')).toEqual({ kind: 'clinica', tenantId: 'clinic-a', tab: 'resumo' })
    expect(resolveAdminRoute('/admin/clinicas/clinic-a/membros')).toEqual({ kind: 'clinica', tenantId: 'clinic-a', tab: 'membros' })
    expect(resolveAdminRoute('/admin/clinicas/clinic-a/auditoria')).toEqual({ kind: 'clinica', tenantId: 'clinic-a', tab: 'auditoria' })
    expect(resolveAdminRoute('/admin/clinicas/clinic-a/resumo')).toEqual({ kind: 'not-found' })
    expect(resolveAdminRoute('/admin/clinicas/clinic-a/outra')).toEqual({ kind: 'not-found' })
    expect(resolveAdminRoute('/admin/clinicas/clinic-a/membros/x')).toEqual({ kind: 'not-found' })
    expect(resolveAdminRoute('/admin/clinicas/%E0%A4%A')).toEqual({ kind: 'not-found' })
  })

  it('clinicaHref codifica o id e omite «resumo»', () => {
    expect(clinicaHref('clinic-a')).toBe('/admin/clinicas/clinic-a')
    expect(clinicaHref('a b/c', 'saude')).toBe('/admin/clinicas/a%20b%2Fc/saude')
    expect(resolveAdminRoute(clinicaHref('a b/c', 'saude'))).toEqual({ kind: 'clinica', tenantId: 'a b/c', tab: 'saude' })
  })

  it('guarda o retorno só para caminhos /admin', () => {
    rememberAdminReturn('/clinicas')
    expect(takeAdminReturn()).toBeNull()
    rememberAdminReturn('/admin/saude')
    expect(takeAdminReturn()).toBe('/admin/saude')
    expect(takeAdminReturn()).toBeNull()
  })
})
