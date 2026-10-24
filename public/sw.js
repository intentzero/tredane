/* Tredane service worker (#42 / DEC-040).
 * Cache só de assets estáticos locais — nunca /api/* nem respostas autenticadas.
 */
const CACHE_VERSION = 'tredane-pwa-v1'
const PRECACHE = [
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE)).then(() => {
      return self.skipWaiting()
    }),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((k) => k.startsWith('tredane-pwa-') && k !== CACHE_VERSION)
          .map((k) => caches.delete(k)),
      )
      await self.clients.claim()
    })(),
  )
})

function isApiRequest(url) {
  return url.pathname.startsWith('/api/')
}

function isNavigational(request) {
  return request.mode === 'navigate' || request.destination === 'document'
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return
  if (isApiRequest(url)) return // network only — sem cache de PII/auth

  if (isNavigational(event.request)) {
    event.respondWith(
      fetch(event.request)
        .then((res) => res)
        .catch(async () => {
          const cached = await caches.match('/')
          if (cached) return cached
          return new Response(
            '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Tredane</title><body style="font-family:system-ui;padding:24px"><h1>Sem ligação</h1><p>O painel precisa de internet para carregar dados da clínica. Nenhuma ação foi confirmada offline.</p></body></html>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          )
        }),
    )
    return
  }

  // Assets estáticos: cache-first com atualização em background
  if (
    event.request.method === 'GET' &&
    (url.pathname.startsWith('/assets/') ||
      url.pathname.startsWith('/icons/') ||
      url.pathname.endsWith('.webmanifest') ||
      url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.woff2'))
  ) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const hit = await cache.match(event.request)
        const fetchPromise = fetch(event.request)
          .then((res) => {
            if (res.ok) void cache.put(event.request, res.clone())
            return res
          })
          .catch(() => hit)
        return hit || fetchPromise
      }),
    )
  }
})

self.addEventListener('push', (event) => {
  let data = {
    title: 'Tredane',
    body: 'Nova conversa',
    url: '/entrar',
    tag: 'tredane',
  }
  try {
    if (event.data) {
      const parsed = event.data.json()
      data = {
        title: typeof parsed.title === 'string' ? parsed.title : data.title,
        body: typeof parsed.body === 'string' ? parsed.body : data.body,
        url: typeof parsed.url === 'string' ? parsed.url : data.url,
        tag: typeof parsed.tag === 'string' ? parsed.tag : data.tag,
      }
    }
  } catch {
    /* ignore malformed */
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag,
      data: { url: data.url },
      renotify: true,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target =
    (event.notification.data && event.notification.data.url) || '/entrar'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.focus()
          if ('navigate' in client) {
            return client.navigate(target)
          }
          return undefined
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target)
      return undefined
    }),
  )
})

self.addEventListener('message', (event) => {
  if (!event.data || typeof event.data !== 'object') return
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
  if (event.data.type === 'CLEAR_CACHES') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))),
    )
  }
})
