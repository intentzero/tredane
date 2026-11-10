/**
 * DEC-156 — faixa persistente + pedido suave de permissão de notificações
 * enquanto houver conversas «Precisa de alguém».
 * Limpa com `conversation.assigned.clearedAwaitingTeam` / resume (DEC-155).
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { PanelApi } from '../../api'
import { isPushSupported, subscribePush } from '../../pwa'
import { useInboxRealtime } from '../../realtime/InboxRealtime'
import { NeedsPersonStrip } from './NeedsPersonStrip'

const PERMISSION_PROMPTED_KEY = 'tredane.push.needs_person_prompted'

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
  children: ReactNode
}

export function NeedsPersonAlerts({
  tenantId,
  api,
  generation,
  children,
}: Props) {
  const [count, setCount] = useState(0)
  const [firstId, setFirstId] = useState<string | null>(null)

  async function refresh() {
    if (typeof api.listInboxConversations !== 'function') return
    try {
      const res = await api.listInboxConversations(
        tenantId,
        { filter: 'needs_person', limit: 1 },
        { generation, expectGeneration: () => generation },
      )
      const n = res.counts?.needsPerson ?? 0
      setCount(n)
      setFirstId(res.conversations[0]?.id ?? null)
      if (n > 0) void maybeAskNotificationPermission(api)
    } catch {
      /* silencioso — a lista/thread continua */
    }
  }

  useEffect(() => {
    void refresh()
  }, [tenantId, generation])

  useInboxRealtime(() => {
    void refresh()
  })

  return (
    <>
      <NeedsPersonStrip
        tenantId={tenantId}
        count={count}
        conversationId={firstId}
      />
      {children}
    </>
  )
}

async function maybeAskNotificationPermission(api: PanelApi): Promise<void> {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'default') return
  if (!isPushSupported()) return
  try {
    if (window.localStorage.getItem(PERMISSION_PROMPTED_KEY) === '1') return
    window.localStorage.setItem(PERMISSION_PROMPTED_KEY, '1')
  } catch {
    /* continua: tenta uma vez nesta sessão */
  }
  try {
    if (typeof api.getPushVapidPublicKey !== 'function') return
    const vapid = await api.getPushVapidPublicKey()
    if (!vapid.supported || !vapid.publicKey) return
    await subscribePush(vapid.publicKey)
  } catch {
    /* permissão negada ou falha — AvisosScreen continua disponível */
  }
}
