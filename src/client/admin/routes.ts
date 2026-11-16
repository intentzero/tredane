/** Rotas da Platform Admin (DEC-192, #828). Sem React Router — pathname + history, como o painel. */

export type AdminArea = 'visao-geral' | 'clinicas' | 'suporte' | 'saude' | 'qualidade-ia'

export type AdminRoute = { kind: 'area'; area: AdminArea } | { kind: 'not-found' }

export const ADMIN_AREAS: ReadonlyArray<{ area: AdminArea; label: string; href: string }> = [
  { area: 'visao-geral', label: 'Visão geral', href: '/admin' },
  { area: 'clinicas', label: 'Clínicas', href: '/admin/clinicas' },
  { area: 'suporte', label: 'Suporte', href: '/admin/suporte' },
  { area: 'saude', label: 'Saúde', href: '/admin/saude' },
  { area: 'qualidade-ia', label: 'Qualidade IA', href: '/admin/qualidade-ia' },
]

function normalize(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/'
}

/** `/admin` e tudo debaixo dele pertence a esta área; o resto é do painel. */
export function isAdminPath(pathname: string): boolean {
  const path = normalize(pathname)
  return path === '/admin' || path.startsWith('/admin/')
}

/** Só devolve rota para caminhos `/admin…`; qualquer sub-rota desconhecida é «not-found». */
export function resolveAdminRoute(pathname: string): AdminRoute | null {
  if (!isAdminPath(pathname)) return null
  const path = normalize(pathname)
  const hit = ADMIN_AREAS.find((a) => a.href === path)
  return hit ? { kind: 'area', area: hit.area } : { kind: 'not-found' }
}

export function adminHref(area: AdminArea): string {
  return ADMIN_AREAS.find((a) => a.area === area)!.href
}

export function navigateAdmin(href: string, replace = false): void {
  if (replace) window.history.replaceState(null, '', href)
  else window.history.pushState(null, '', href)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

const RETURN_KEY = 'tredane.admin.return'

/** Volta a `/admin…` depois do login (sessão expirada a meio, spec JRN-20). Só caminhos /admin. */
export function rememberAdminReturn(pathname: string): void {
  if (!isAdminPath(pathname)) return
  try {
    window.sessionStorage.setItem(RETURN_KEY, normalize(pathname))
  } catch {
    /* sem storage: volta à lista de clínicas, sem perder acesso */
  }
}

export function takeAdminReturn(): string | null {
  try {
    const value = window.sessionStorage.getItem(RETURN_KEY)
    window.sessionStorage.removeItem(RETURN_KEY)
    return value && isAdminPath(value) ? value : null
  } catch {
    return null
  }
}
