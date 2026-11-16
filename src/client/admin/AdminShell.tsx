import { Activity, Building2, LayoutDashboard, LifeBuoy, Sparkles, type LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { SignOutButton } from '../panel/auth/ClerkBridge'
import { ADMIN_AREAS, navigateAdmin, resolveAdminRoute, type AdminArea, type AdminRoute } from './routes'
import { AdminNotFound } from './AdminStates'
import { ClinicaDetalhe } from './clinicas/ClinicaDetalhe'
import { ClinicasList } from './clinicas/ClinicasList'
import { NovaClinica } from './clinicas/NovaClinica'
import { SaudeGlobal } from './saude/SaudeGlobal'
import { VisaoGeral } from './saude/VisaoGeral'

const ICONS: Record<AdminArea, LucideIcon> = {
  'visao-geral': LayoutDashboard,
  clinicas: Building2,
  suporte: LifeBuoy,
  saude: Activity,
  'qualidade-ia': Sparkles,
}

/** Cada área chega com a sua issue do épico #827; até lá mostra só o que vem a seguir. */
const PENDING: Record<Exclude<AdminArea, 'clinicas' | 'visao-geral' | 'saude'>, { title: string; issue: string; text: string }> = {
  suporte: {
    title: 'Suporte',
    issue: '#831',
    text: 'Pedidos e sessões de suporte de todas as clínicas.',
  },
  'qualidade-ia': {
    title: 'Qualidade IA',
    issue: '#834',
    text: 'Métricas agregadas, sombra do interpretador e amostras para revisão.',
  },
}

function useAdminRoute(): AdminRoute {
  const [route, setRoute] = useState<AdminRoute>(
    () => resolveAdminRoute(window.location.pathname) ?? { kind: 'not-found' },
  )
  useEffect(() => {
    const onPop = () =>
      setRoute(resolveAdminRoute(window.location.pathname) ?? { kind: 'not-found' })
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  return route
}

export default function AdminShell() {
  const route = useAdminRoute()
  const current: AdminArea | null =
    route.kind === 'area'
      ? route.area
      : route.kind === 'clinica' || route.kind === 'clinica-nova'
        ? 'clinicas'
        : null

  return (
    <div className="admin-shell">
      <nav className="admin-nav" aria-label="Platform Admin">
        <div className="admin-brand">
          <span className="admin-brand-mark" aria-hidden="true">T</span>
          <span className="admin-brand-text">
            <strong>Tredane</strong>
            <span>Platform Admin</span>
          </span>
        </div>
        <ul className="admin-nav-list">
          {ADMIN_AREAS.map(({ area, label, href }) => {
            const Icon = ICONS[area]
            return (
              <li key={area}>
                <a
                  href={href}
                  aria-current={current === area ? 'page' : undefined}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                    e.preventDefault()
                    navigateAdmin(href)
                  }}
                >
                  <Icon aria-hidden="true" size={20} strokeWidth={2} />
                  {label}
                </a>
              </li>
            )
          })}
        </ul>
        <div className="admin-nav-foot">
          <span>Operador Tredane</span>
          <span className="admin-nav-note">superadmin · sem acesso a conversas</span>
          <SignOutButton />
        </div>
      </nav>
      <main className="admin-main">
        {route.kind === 'not-found' ? (
          <AdminNotFound />
        ) : route.kind === 'clinica-nova' ? (
          <NovaClinica />
        ) : route.kind === 'clinica' ? (
          <ClinicaDetalhe key={route.tenantId} tenantId={route.tenantId} tab={route.tab} />
        ) : route.area === 'clinicas' ? (
          <ClinicasList />
        ) : route.area === 'visao-geral' ? (
          <VisaoGeral />
        ) : route.area === 'saude' ? (
          <SaudeGlobal />
        ) : (
          <section aria-labelledby="admin-area-title" className="admin-pending">
            <h1 id="admin-area-title">{PENDING[route.area].title}</h1>
            <p>{PENDING[route.area].text}</p>
            <p className="admin-muted">Esta área chega com a issue {PENDING[route.area].issue} do épico #827.</p>
          </section>
        )}
      </main>
    </div>
  )
}
