/** Tema do painel (DEC-092): Sistema (padrão), Claro ou Escuro; a escolha fica só neste aparelho. */
export type ThemePreference = 'system' | 'light' | 'dark'

export const THEME_STORAGE_KEY = 'tredane-theme'

/** Mesmas cores de `meta[name=theme-color]` que a barra do sistema deve mostrar (cabeçalho = surface.card). */
const THEME_COLOR = { light: '#FFFFFF', dark: '#162423' } as const

export function isThemePreference(v: unknown): v is ThemePreference {
  return v === 'system' || v === 'light' || v === 'dark'
}

/** Lê a escolha salva; armazenamento indisponível ou valor inválido caem em Sistema. */
export function readThemePreference(): ThemePreference {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemePreference(v) ? v : 'system'
  } catch {
    return 'system'
  }
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Tema efetivamente aplicado agora. */
export function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
  return pref === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : pref
}

/** Aplica no `<html>`: `data-theme` só quando a escolha é explícita; Sistema deixa o CSS seguir o aparelho. */
export function applyThemePreference(pref: ThemePreference): void {
  const root = document.documentElement
  if (pref === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', pref)
  const effective = resolveTheme(pref)
  root.style.colorScheme = effective
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLOR[effective])
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', 'light dark')
}

export function saveThemePreference(pref: ThemePreference): void {
  try {
    if (pref === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY)
    else window.localStorage.setItem(THEME_STORAGE_KEY, pref)
  } catch {
    // Sem armazenamento: a escolha vale até recarregar e o padrão volta a ser Sistema.
  }
  applyThemePreference(pref)
}

/** Aplica a escolha salva e reaplica quando o sistema muda (só importa em Sistema). Devolve o cancelamento. */
export function initTheme(): () => void {
  applyThemePreference(readThemePreference())
  if (typeof window.matchMedia !== 'function') return () => {}
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => applyThemePreference(readThemePreference())
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
