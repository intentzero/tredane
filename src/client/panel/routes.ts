/** Rotas produtivas do painel (#22). Sem React Router — pathname + history. */

export type PanelArea = 'conversas' | 'acompanhamento' | 'agenda' | 'clinica'

export type PanelRoute =
  | { kind: 'entrar' }
  | { kind: 'clinicas' }
  | { kind: 'area'; area: PanelArea; tenantId: string }

const AREA_PATH: Record<PanelArea, string> = {
  conversas: 'conversas',
  acompanhamento: 'acompanhamento',
  agenda: 'agenda',
  clinica: 'clinica',
}

const PATH_AREA: Record<string, PanelArea> = {
  conversas: 'conversas',
  acompanhamento: 'acompanhamento',
  agenda: 'agenda',
  clinica: 'clinica',
}

export function resolvePanelRoute(pathname: string): PanelRoute | null {
  const path = pathname.replace(/\/+$/, '') || '/'
  // Prefixo: Clerk SignIn usa /entrar/factor-one etc.
  if (path === '/entrar' || path.startsWith('/entrar/')) return { kind: 'entrar' }
  if (path === '/clinicas') return { kind: 'clinicas' }

  const match = /^\/c\/([^/]+)\/([^/]+)$/.exec(path)
  if (!match) return null
  const tenantId = decodeURIComponent(match[1] ?? '')
  const areaSeg = match[2] ?? ''
  const area = PATH_AREA[areaSeg]
  if (!tenantId || !area) return null
  return { kind: 'area', area, tenantId }
}

export function panelHref(route: PanelRoute): string {
  switch (route.kind) {
    case 'entrar':
      return '/entrar'
    case 'clinicas':
      return '/clinicas'
    case 'area':
      return `/c/${encodeURIComponent(route.tenantId)}/${AREA_PATH[route.area]}`
  }
}

export function areaTitle(area: PanelArea): string {
  switch (area) {
    case 'conversas':
      return 'Conversas'
    case 'acompanhamento':
      return 'Acompanhamento'
    case 'agenda':
      return 'Agenda'
    case 'clinica':
      return 'Clínica'
  }
}

/** Rótulo curto na barra inferior em 360 px (DEC-045). */
export function areaNavLabel(area: PanelArea): string {
  if (area === 'acompanhamento') return 'Acompanhar'
  return areaTitle(area)
}

export function navigatePanel(route: PanelRoute, replace = false): void {
  const href = panelHref(route)
  if (replace) {
    window.history.replaceState(null, '', href)
  } else {
    window.history.pushState(null, '', href)
  }
  window.dispatchEvent(new PopStateEvent('popstate'))
}
