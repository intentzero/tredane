import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  THEME_STORAGE_KEY,
  applyThemePreference,
  readThemePreference,
  resolveTheme,
  saveThemePreference,
} from './theme'

function mockSystemDark(dark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation(() => ({
      matches: dark,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

describe('tema do painel (DEC-098)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.head.innerHTML = '<meta name="theme-color" content="#FFFFFF"><meta name="color-scheme" content="light">'
    mockSystemDark(false)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('sem escolha salva o padrão é Sistema', () => {
    expect(readThemePreference()).toBe('system')
  })

  it('valor inválido salvo cai em Sistema', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'roxo')
    expect(readThemePreference()).toBe('system')
  })

  it('Sistema resolve pelo aparelho e não escreve data-theme', () => {
    mockSystemDark(true)
    applyThemePreference('system')
    expect(resolveTheme('system')).toBe('dark')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#162423')
  })

  it('escolha explícita vence o aparelho e fica salva; voltar a Sistema limpa', () => {
    mockSystemDark(true)
    saveThemePreference('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#FFFFFF')
    saveThemePreference('system')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('armazenamento indisponível não quebra e ainda aplica o tema', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    expect(() => saveThemePreference('dark')).not.toThrow()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    vi.restoreAllMocks()
  })
})
