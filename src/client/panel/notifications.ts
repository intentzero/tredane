/**
 * DEC-156 — fechar notificações do browser/PWA da conversa ao Assumir.
 * Tag alinhada a `conversationPushTag` no push (`conversation:tenant:id`).
 */

export function conversationNotificationTag(
  tenantId: string,
  conversationId: string,
): string {
  return `conversation:${tenantId}:${conversationId}`
}

/** Best-effort: limpa avisos do SW com a tag da conversa. */
export async function closeConversationNotifications(
  tenantId: string,
  conversationId: string,
): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg || typeof reg.getNotifications !== 'function') return
    const tag = conversationNotificationTag(tenantId, conversationId)
    const list = await reg.getNotifications({ tag })
    for (const n of list) n.close()
  } catch {
    /* sem SW / permissão */
  }
}
