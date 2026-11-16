import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { resolveProvaRoute } from './prova/routes'
import { resolveRootRedirect } from './panel/routes'
import { isAdminPath } from './admin/routes'
import './styles.css'
import { initTheme } from './panel/theme'

initTheme()

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

const pathname = window.location.pathname
const provaRoute = resolveProvaRoute(pathname)
const rootRedirect = resolveRootRedirect(pathname)
if (rootRedirect) window.location.replace(rootRedirect)

const ProvaApp = lazy(async () => {
  await import('./ui/panel.css')
  const mod = await import('./prova/ProvaApp')
  return { default: mod.ProvaApp }
})

const AdminApp = lazy(async () => {
  await import('./ui/panel.css')
  const mod = await import('./admin/AdminApp')
  return { default: mod.AdminApp }
})

const PanelApp = lazy(async () => {
  await import('./ui/panel.css')
  const mod = await import('./panel/PanelApp')
  return { default: mod.PanelApp }
})

createRoot(root).render(
  <StrictMode>
    <Suspense fallback={<p style={{ padding: 24, fontFamily: 'system-ui' }}>A carregar…</p>}>
      {provaRoute ? (
        <div className="panel-root">
          <ProvaApp route={provaRoute} />
        </div>
      ) : rootRedirect ? null : isAdminPath(pathname) ? (
        <AdminApp />
      ) : (
        <PanelApp />
      )}
    </Suspense>
  </StrictMode>,
)
