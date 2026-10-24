import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { resolveProvaRoute } from './prova/routes'
import { resolvePanelRoute } from './panel/routes'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

const pathname = window.location.pathname
const provaRoute = resolveProvaRoute(pathname)
const panelRoute = resolvePanelRoute(pathname)

const App = lazy(async () => {
  const mod = await import('./App')
  return { default: mod.App }
})

const ProvaApp = lazy(async () => {
  await import('./ui/panel.css')
  const mod = await import('./prova/ProvaApp')
  return { default: mod.ProvaApp }
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
      ) : panelRoute ? (
        <PanelApp />
      ) : (
        <App />
      )}
    </Suspense>
  </StrictMode>,
)
