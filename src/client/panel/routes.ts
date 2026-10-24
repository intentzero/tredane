/** Rotas produtivas do painel (#22/#28/#29/#30). Sem React Router — pathname + history. */

export type PanelArea = 'conversas' | 'acompanhamento' | 'agenda' | 'clinica'

export type ClinicaSection =
  | 'hub'
  | 'servicos'
  | 'servico'
  | 'recursos'
  | 'profissional'
  | 'sala'
  | 'horarios'
  | 'whatsapp'
  | 'whatsapp-trocar'
  | 'whatsapp-desconectar'

/** Sub-rotas de Conversas (#29): lista → thread → contacto. */
export type ConversasSection = 'lista' | 'thread' | 'contato'

/** Sub-rotas de Acompanhamento (#30): quadro por etapa → detalhe. */
export type AcompanhamentoSection = 'quadro' | 'detalhe'

/** Sub-rotas da Agenda (#35/#36): dia/semana → detalhe → Agendar. */
export type AgendaSection = 'dia' | 'semana' | 'agendar' | 'compromisso'

export type PanelRoute =
  | { kind: 'entrar' }
  | { kind: 'clinicas' }
  | {
      kind: 'area'
      area: 'conversas'
      tenantId: string
      section: ConversasSection
      conversationId?: string
      contactId?: string
    }
  | {
      kind: 'area'
      area: 'acompanhamento'
      tenantId: string
      section: AcompanhamentoSection
      opportunityId?: string
    }
  | {
      kind: 'area'
      area: 'agenda'
      tenantId: string
      section: AgendaSection
      appointmentId?: string
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
  if (head === 'whatsapp') {
    if (parts[1] === 'trocar') return { section: 'whatsapp-trocar' }
    if (parts[1] === 'desconectar') return { section: 'whatsapp-desconectar' }
    return { section: 'whatsapp' }
  }
  return { section: 'hub' }
}

function parseConversasRest(rest: string | undefined): {
  section: ConversasSection
  conversationId?: string
  contactId?: string
} {
  if (!rest) return { section: 'lista' }
  const parts = rest.split('/').filter(Boolean)
  if (parts[0] === 'contato' && parts[1]) {
    return { section: 'contato', contactId: decodeURIComponent(parts[1]) }
  }
  const conversationId = decodeURIComponent(parts[0]!)
  if (parts[1] === 'contato') {
    return { section: 'contato', conversationId, contactId: undefined }
  }
  return { section: 'thread', conversationId }
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
  if (area === 'conversas') {
    const parsed = parseConversasRest(match[3])
    return {
      kind: 'area',
      area: 'conversas',
      tenantId,
      section: parsed.section,
      conversationId: parsed.conversationId,
      contactId: parsed.contactId,
    }
  }
  if (area === 'acompanhamento') {
    const rest = match[3]
    if (rest) {
      const opportunityId = decodeURIComponent(rest.split('/')[0]!)
      return {
        kind: 'area',
        area: 'acompanhamento',
        tenantId,
        section: 'detalhe',
        opportunityId,
      }
    }
    return {
      kind: 'area',
      area: 'acompanhamento',
      tenantId,
      section: 'quadro',
    }
  }
  if (area === 'agenda') {
    const parts = (match[3] ?? '').split('/').filter(Boolean)
    const head = parts[0]
    if (head === 'agendar') {
      return { kind: 'area', area: 'agenda', tenantId, section: 'agendar' }
    }
    if (head === 'semana') {
      return { kind: 'area', area: 'agenda', tenantId, section: 'semana' }
    }
    if (head === 'compromisso' && parts[1]) {
      return {
        kind: 'area',
        area: 'agenda',
        tenantId,
        section: 'compromisso',
        appointmentId: decodeURIComponent(parts[1]),
      }
    }
    return { kind: 'area', area: 'agenda', tenantId, section: 'dia' }
  }
  return null
}

export function panelHref(route: PanelRoute): string {
  switch (route.kind) {
    case 'entrar':
      return '/entrar'
    case 'clinicas':
      return '/clinicas'
    case 'area': {
      const base = `/c/${encodeURIComponent(route.tenantId)}/${AREA_PATH[route.area]}`
      if (route.area === 'conversas') {
        if (route.section === 'lista') return base
        if (route.section === 'contato' && route.contactId && !route.conversationId) {
          return `${base}/contato/${encodeURIComponent(route.contactId)}`
        }
        if (route.section === 'contato' && route.conversationId) {
          return `${base}/${encodeURIComponent(route.conversationId)}/contato`
        }
        if (route.conversationId) {
          return `${base}/${encodeURIComponent(route.conversationId)}`
        }
        return base
      }
      if (route.area === 'acompanhamento') {
        if (route.section === 'detalhe' && route.opportunityId) {
          return `${base}/${encodeURIComponent(route.opportunityId)}`
        }
        return base
      }
      if (route.area === 'agenda') {
        if (route.section === 'agendar') return `${base}/agendar`
        if (route.section === 'semana') return `${base}/semana`
        if (route.section === 'compromisso' && route.appointmentId) {
          return `${base}/compromisso/${encodeURIComponent(route.appointmentId)}`
        }
        return base
      }
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
        case 'whatsapp':
          return `${base}/whatsapp`
        case 'whatsapp-trocar':
          return `${base}/whatsapp/trocar`
        case 'whatsapp-desconectar':
          return `${base}/whatsapp/desconectar`
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

/** Rota de área do shell — Clínica hub (#28); Conversas (#29); Acompanhamento (#30). */
export function areaRoute(tenantId: string, area: PanelArea): PanelRoute {
  if (area === 'clinica') {
    return { kind: 'area', area: 'clinica', tenantId, section: 'hub' }
  }
  if (area === 'conversas') {
    return { kind: 'area', area: 'conversas', tenantId, section: 'lista' }
  }
  if (area === 'acompanhamento') {
    return { kind: 'area', area: 'acompanhamento', tenantId, section: 'quadro' }
  }
  return { kind: 'area', area: 'agenda', tenantId, section: 'dia' }
}
