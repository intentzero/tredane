/**
 * DEC-156 — faixa persistente + pedido suave de permissão de notificações
 * enquanto houver conversas «Precisa de alguém».
 * Limpa com `conversation.assigned.clearedAwaitingTeam` / resume (DEC-155).
 *
 * Confirmado (Paulo, 16/11/2026): faixa no **shell** (qualquer área) + título
 * do separador `(N) Precisa de alguém · Tredane` (opções A+E).
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { PanelApi } from '../../api'
import { isPushSupported, subscribePush } from '../../pwa'
import { useInboxRealtime } from '../../realtime/InboxRealtime'
import { NeedsPersonStrip } from './NeedsPersonStrip'

const PERMISSION_PROMPTED_KEY = 'tredane.push.needs_person_prompted'
/** Áreas com WS pedem refresh da faixa do shell sem segundo socket. */
export const NEEDS_PERSON_REFRESH_EVENT = 'tredane:needs-person-refresh'
const DEFAULT_DOC_TITLE = 'Tredane | Atendimento inteligente'
const POLL_MS = 20_000

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
  /** DEC-161: conversa aberta; se for a única à espera, o cartão da conversa já avisa. */
  openConversationId?: string | null
  children?: ReactNode
}

export function NeedsPersonAlerts({
  tenantId,
  api,
  generation,
  openConversationId = null,
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
      /* silencioso — o resto do painel continua */
    }
  }

  useEffect(() => {
    void refresh()
  }, [tenantId, generation])

  // Dentro de um InboxRealtimeProvider (áreas) — refresh imediato.
  useInboxRealtime(() => {
    void refresh()
  })

  // Shell: sem WS próprio — poll + foco + evento das áreas.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const onCustom = () => {
      void refresh()
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    window.addEventListener(NEEDS_PERSON_REFRESH_EVENT, onCustom)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, POLL_MS)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
      window.removeEventListener(NEEDS_PERSON_REFRESH_EVENT, onCustom)
      window.clearInterval(timer)
    }
  }, [tenantId, generation])

  // Opção E: título do separador enquanto há handoff aberto.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const previous = document.title || DEFAULT_DOC_TITLE
    if (count > 0) {
      document.title =
        count === 1
          ? 'Precisa de alguém · Tredane'
          : `(${count}) Precisa de alguém · Tredane`
    } else {
      document.title = DEFAULT_DOC_TITLE
    }
    return () => {
      document.title = previous.includes('Precisa de alguém')
        ? DEFAULT_DOC_TITLE
        : previous
    }
  }, [count])

  const stripCount =
    count === 1 && firstId != null && firstId === openConversationId ? 0 : count

  return (
    <>
      <NeedsPersonStrip
        tenantId={tenantId}
        count={stripCount}
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
