import { beforeEach, describe, expect, it } from 'vitest'
import {
  captureInviteTokenFromLocation,
  captureOAuthReturnFromLocation,
  clearPendingInviteToken,
  clearPendingOAuthAuthorize,
  clearPickingClinic,
  isPickingClinic,
  markPickingClinic,
  readLastTenantId,
  readPendingInviteToken,
  readPendingOAuthAuthorize,
  sanitizeOAuthAuthorizeReturn,
  writeLastTenantId,
  writePendingInviteToken,
  writePendingOAuthAuthorize,
} from './session'

describe('última clínica do aparelho', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('guarda e apaga o identificador', () => {
    expect(readLastTenantId()).toBeNull()
    writeLastTenantId('clinic-demo-a')
    expect(readLastTenantId()).toBe('clinic-demo-a')
    writeLastTenantId(null)
    expect(readLastTenantId()).toBeNull()
  })

  it('«Trocar clínica» marca a escolha e a limpeza desmarca', () => {
    expect(isPickingClinic()).toBe(false)
    markPickingClinic()
    expect(isPickingClinic()).toBe(true)
    clearPickingClinic()
    expect(isPickingClinic()).toBe(false)
  })
})

describe('token de convite pendente (S3)', () => {
  beforeEach(() => {
    sessionStorage.clear()
    window.history.replaceState(null, '', '/')
  })

  it('guarda e limpa sem expor o valor em APIs tipadas de rota', () => {
    expect(readPendingInviteToken()).toBeNull()
    writePendingInviteToken('tok_secreto_de_teste_nao_logar')
    expect(readPendingInviteToken()).toBe('tok_secreto_de_teste_nao_logar')
    clearPendingInviteToken()
    expect(readPendingInviteToken()).toBeNull()
  })

  it('captura ?token= da URL, guarda na sessão e tira da barra', () => {
    window.history.replaceState(
      null,
      '',
      '/invite/accept?token=tok_url_secreto_123456789',
    )
    const captured = captureInviteTokenFromLocation()
    expect(captured).toBe('tok_url_secreto_123456789')
    expect(readPendingInviteToken()).toBe('tok_url_secreto_123456789')
    expect(window.location.pathname).toBe('/invite/accept')
    expect(window.location.search).toBe('')
  })

  it('reusa o token da sessão quando a URL já não tem query', () => {
    writePendingInviteToken('tok_ja_guardado')
    window.history.replaceState(null, '', '/invite/accept')
    expect(captureInviteTokenFromLocation()).toBe('tok_ja_guardado')
  })
})

describe('retorno OAuth /authorize após login', () => {
  beforeEach(() => {
    sessionStorage.clear()
    window.history.replaceState(null, '', '/')
  })

  it('sanitize só aceita /authorize relativo', () => {
    expect(sanitizeOAuthAuthorizeReturn('/authorize?client_id=1')).toBe(
      '/authorize?client_id=1',
    )
    expect(sanitizeOAuthAuthorizeReturn('/authorize')).toBe('/authorize')
    expect(sanitizeOAuthAuthorizeReturn('https://evil.test/authorize')).toBeNull()
    expect(sanitizeOAuthAuthorizeReturn('//evil.test/authorize')).toBeNull()
    expect(sanitizeOAuthAuthorizeReturn('/clinicas')).toBeNull()
    expect(sanitizeOAuthAuthorizeReturn('/authorize/../entrar')).toBeNull()
  })

  it('captura return_to em /entrar e guarda na sessão', () => {
    window.history.replaceState(
      null,
      '',
      '/entrar?return_to=%2Fauthorize%3Fclient_id%3Dabc%26scope%3Dlab%3Aconverse',
    )
    const captured = captureOAuthReturnFromLocation()
    expect(captured).toBe('/authorize?client_id=abc&scope=lab:converse')
    expect(readPendingOAuthAuthorize()).toBe(
      '/authorize?client_id=abc&scope=lab:converse',
    )
  })

  it('reusa a sessão quando a URL já não tem return_to (Clerk path routing)', () => {
    writePendingOAuthAuthorize('/authorize?client_id=kept')
    window.history.replaceState(null, '', '/entrar/factor-one')
    expect(captureOAuthReturnFromLocation()).toBe('/authorize?client_id=kept')
    clearPendingOAuthAuthorize()
    expect(readPendingOAuthAuthorize()).toBeNull()
  })

  it('ignora return_to inseguro', () => {
    window.history.replaceState(
      null,
      '',
      '/entrar?return_to=' + encodeURIComponent('https://evil.test/phish'),
    )
    expect(captureOAuthReturnFromLocation()).toBeNull()
  })
})
