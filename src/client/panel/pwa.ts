/**
 * Registo PWA / push no cliente (#42).
 * Cache só de assets; limpeza em logout / troca de clínica / revogação.
 */

const SW_URL = '/sw.js'

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  const mq = window.matchMedia('(display-mode: standalone)').matches
  const ios = 'standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  return mq || ios
}

export function detectInstallPlatform(): 'ios' | 'android' | 'desktop' {
  const ua = navigator.userAgent || ''
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'desktop'
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    const reg = await navigator.serviceWorker.register(SW_URL, { scope: '/' })
    return reg
  } catch {
    return null
  }
}

export function urlBase64ToUint8Array(base64url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4)
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

export async function subscribePush(
  vapidPublicKey: string,
): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return null
  const reg = await navigator.serviceWorker.ready
  const existing = await reg.pushManager.getSubscription()
  if (existing) return existing
  const key = urlBase64ToUint8Array(vapidPublicKey)
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key.buffer as ArrayBuffer,
  })
}

/** Subscrição push já existente neste aparelho (sem pedir permissão). */
export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg) return null
    return await reg.pushManager.getSubscription()
  } catch {
    return null
  }
}

export async function unsubscribePush(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return false
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return false
  return sub.unsubscribe()
}

/** Limpa caches do SW — logout / troca de clínica / acesso revogado (UX-05). */
export async function clearPwaCaches(): Promise<void> {
  if ('caches' in window) {
    const keys = await caches.keys()
    await Promise.all(keys.map((k) => caches.delete(k)))
  }
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations()
    for (const reg of regs) {
      reg.active?.postMessage({ type: 'CLEAR_CACHES' })
    }
  }
}

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferredInstall: BeforeInstallPromptEvent | null = null

export function captureInstallPrompt(event: Event): void {
  event.preventDefault()
  deferredInstall = event as BeforeInstallPromptEvent
}

export function getDeferredInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferredInstall
}

export function clearDeferredInstallPrompt(): void {
  deferredInstall = null
}
