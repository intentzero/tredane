/** Rotas produtivas do painel (#22/#28). Sem React Router — pathname + history. */

export type PanelArea = 'conversas' | 'acompanhamento' | 'agenda' | 'clinica'

export type ClinicaSection =
  | 'hub'
  | 'servicos'
  | 'servico'
  | 'recursos'
  | 'profissional'
  | 'sala'
  | 'horarios'

export type PanelRoute =
  | { kind: 'entrar' }
  | { kind: 'clinicas' }
  | {
      kind: 'area'
      area: Exclude<PanelArea, 'clinica'>
      tenantId: string
    }
  | {
      kind: 'area'
      area: 'clinica'
      tenantId: string
      section: ClinicaSection
      entityId?: string
    }

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

function parseClinicaRest(rest: string | undefined): {
  section: ClinicaSection
  entityId?: string
} {
  if (!rest) return { section: 'hub' }
  const parts = rest.split('/').filter(Boolean)
  const head = parts[0]
  if (head === 'servicos') {
    if (parts[1] === 'novo') return { section: 'servico', entityId: 'novo' }
    if (parts[1]) return { section: 'servico', entityId: decodeURIComponent(parts[1]) }
    return { section: 'servicos' }
  }
  if (head === 'recursos') {
    if (parts[1] === 'profissional') {
      const id = parts[2] === 'novo' ? 'novo' : parts[2]
      return {
        section: 'profissional',
        entityId: id ? decodeURIComponent(id) : 'novo',
      }
    }
    if (parts[1] === 'sala') {
      const id = parts[2] === 'novo' ? 'novo' : parts[2]
      return {
        section: 'sala',
        entityId: id ? decodeURIComponent(id) : 'novo',
      }
    }
    return { section: 'recursos' }
  }
  if (head === 'horarios') return { section: 'horarios' }
  return { section: 'hub' }
}

export function resolvePanelRoute(pathname: string): PanelRoute | null {
  const path = pathname.replace(/\/+$/, '') || '/'
  // Prefixo: Clerk SignIn usa /entrar/factor-one etc.
  if (path === '/entrar' || path.startsWith('/entrar/')) return { kind: 'entrar' }
  if (path === '/clinicas') return { kind: 'clinicas' }

  const match = /^\/c\/([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(path)
  if (!match) return null
  const tenantId = decodeURIComponent(match[1] ?? '')
  const areaSeg = match[2] ?? ''
  const area = PATH_AREA[areaSeg]
  if (!tenantId || !area) return null
  if (area === 'clinica') {
    const { section, entityId } = parseClinicaRest(match[3])
    return { kind: 'area', area: 'clinica', tenantId, section, entityId }
  }
  return { kind: 'area', area, tenantId }
}

export function panelHref(route: PanelRoute): string {
  switch (route.kind) {
    case 'entrar':
      return '/entrar'
    case 'clinicas':
      return '/clinicas'
    case 'area': {
      const base = `/c/${encodeURIComponent(route.tenantId)}/${AREA_PATH[route.area]}`
      if (route.area !== 'clinica') return base
      switch (route.section) {
        case 'hub':
          return base
        case 'servicos':
          return `${base}/servicos`
        case 'servico':
          return `${base}/servicos/${encodeURIComponent(route.entityId ?? 'novo')}`
        case 'recursos':
          return `${base}/recursos`
        case 'profissional':
          return `${base}/recursos/profissional/${encodeURIComponent(route.entityId ?? 'novo')}`
        case 'sala':
          return `${base}/recursos/sala/${encodeURIComponent(route.entityId ?? 'novo')}`
        case 'horarios':
          return `${base}/horarios`
      }
    }
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

/** Rota de área do shell — Clínica abre no hub (#28). */
export function areaRoute(tenantId: string, area: PanelArea): PanelRoute {
  if (area === 'clinica') {
    return { kind: 'area', area: 'clinica', tenantId, section: 'hub' }
  }
  return { kind: 'area', area, tenantId }
}
