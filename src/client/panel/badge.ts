/**
 * Badge do ícone da app (Badging API). iOS 16.4+: só PWA instalada com
 * permissão de notificações; noutros casos é no-op (feature-detect).
 * Conta conversas com não lidas — nunca conteúdo.
 */
type BadgeNavigator = {
  setAppBadge?: (n?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

export function applyAppBadge(count: number, nav?: BadgeNavigator): void {
  const n: BadgeNavigator | undefined =
    nav ?? (typeof navigator !== 'undefined' ? (navigator as unknown as BadgeNavigator) : undefined)
  if (!n || !Number.isFinite(count)) return
  try {
    if (count > 0 && typeof n.setAppBadge === 'function') {
      void n.setAppBadge(Math.floor(count)).catch(() => undefined)
    } else if (count <= 0 && typeof n.clearAppBadge === 'function') {
      void n.clearAppBadge().catch(() => undefined)
    }
  } catch {
    /* sem suporte */
  }
}
