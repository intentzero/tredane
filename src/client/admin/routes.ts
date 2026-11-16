/** Rotas da Platform Admin (DEC-192, #828). Sem React Router — pathname + history, como o painel. */

export type AdminArea = 'visao-geral' | 'clinicas' | 'suporte' | 'saude' | 'qualidade-ia'

export type ClinicaTab = 'resumo' | 'membros' | 'saude' | 'suporte' | 'auditoria'

export const CLINICA_TABS: ReadonlyArray<{ tab: ClinicaTab; label: string }> = [
  { tab: 'resumo', label: 'Resumo' },
  { tab: 'membros', label: 'Membros' },
  { tab: 'saude', label: 'Saúde' },
  { tab: 'suporte', label: 'Suporte' },
  { tab: 'auditoria', label: 'Auditoria' },
]

export type AdminRoute =
  | { kind: 'area'; area: AdminArea }
  /** Detalhe da clínica (PA-04): a aba fica na URL para poder ser partilhada. */
  | { kind: 'clinica'; tenantId: string; tab: ClinicaTab }
  | { kind: 'not-found' }

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
  if (hit) return { kind: 'area', area: hit.area }
  const m = /^\/admin\/clinicas\/([^/]+)(?:\/([^/]+))?$/.exec(path)
  if (m) {
    let tenantId: string
    try {
      tenantId = decodeURIComponent(m[1]!)
    } catch {
      return { kind: 'not-found' }
    }
    if (!tenantId) return { kind: 'not-found' }
    // «resumo» é a aba por omissão: `/admin/clinicas/:id/resumo` não existe (uma só URL por aba).
    if (m[2] === undefined) return { kind: 'clinica', tenantId, tab: 'resumo' }
    const tab = CLINICA_TABS.find((t) => t.tab === m[2] && t.tab !== 'resumo')?.tab
    if (tab) return { kind: 'clinica', tenantId, tab }
  }
  return { kind: 'not-found' }
}

export function clinicaHref(tenantId: string, tab: ClinicaTab = 'resumo'): string {
  const base = `/admin/clinicas/${encodeURIComponent(tenantId)}`
  return tab === 'resumo' ? base : `${base}/${tab}`
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
