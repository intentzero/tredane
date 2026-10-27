import { useEffect, useState } from 'react'
import { useAuthSession } from '../../auth/AuthContext'
import { useTenant } from '../../tenant/TenantContext'
import { ErrorState, LoadingState } from '../../states/StatusScreens'
import type { ConversasSection } from '../../routes'
import { InboxContactScreen } from './InboxContact'
import { InboxList } from './InboxList'
import { InboxThread } from './InboxThread'
import { InboxRealtimeProvider } from '../../realtime/InboxRealtime'
import { friendlyError } from '../../copy/errors'

type Props = {
  tenantId: string
  section: ConversasSection
  conversationId?: string
  contactId?: string
}

/**
 * Área Conversas (#29): lista partilhada, thread e ficha do contato.
 * Sem Acompanhamento (#30) nem webhooks WhatsApp (F3).
 */
export function ConversasArea({
  tenantId,
  section,
  conversationId,
  contactId,
}: Props) {
  const { api, status } = useAuthSession()
  const { generation, active } = useTenant()
  const isOwner = active.phase === 'ready' && active.context.role === 'owner'
  const [viewerId, setViewerId] = useState<string | null>(null)

  useEffect(() => {
    if (!api || status.phase !== 'ready') return
    let cancelled = false
    void api.getMe({ generation, expectGeneration: () => generation }).then(
      (me) => {
        if (!cancelled) setViewerId(me.clerkUserId)
      },
      () => {
        if (!cancelled) setViewerId(null)
      },
    )
    return () => {
      cancelled = true
    }
  }, [api, status.phase, generation])

  if (!api || status.phase !== 'ready') {
    return <LoadingState label="Preparando sessão…" />
  }
  if (!viewerId) {
    return <LoadingState label="Identificando você…" />
  }

  // Uma ligação WS por clínica enquanto a área Conversas está aberta.
  return (
    <InboxRealtimeProvider tenantId={tenantId} api={api} generation={generation}>
      <ConversasSectionView
        tenantId={tenantId}
        section={section}
        conversationId={conversationId}
        contactId={contactId}
        api={api}
        generation={generation}
        viewerId={viewerId}
        isOwner={isOwner}
      />
    </InboxRealtimeProvider>
  )
}

function ConversasSectionView({
  tenantId,
  section,
  conversationId,
  contactId,
  api,
  generation,
  viewerId,
  isOwner,
}: Props & {
  api: NonNullable<ReturnType<typeof useAuthSession>['api']>
  generation: number
  viewerId: string
  isOwner: boolean
}) {
  if (section === 'thread' && conversationId) {
    return (
      <InboxThread
        tenantId={tenantId}
        conversationId={conversationId}
        api={api}
        generation={generation}
        viewerClerkUserId={viewerId}
      />
    )
  }

  if (section === 'contato') {
    const resolvedContactId = contactId
    if (!resolvedContactId && conversationId) {
      return (
        <ContactViaConversation
          tenantId={tenantId}
          conversationId={conversationId}
          api={api}
          generation={generation}
          isOwner={isOwner}
        />
      )
    }
    if (!resolvedContactId) {
      return (
        <ErrorState
          title="Contato em falta"
          description="Não foi possível abrir as informações do contato."
        />
      )
    }
    return (
      <InboxContactScreen
        tenantId={tenantId}
        contactId={resolvedContactId}
        conversationId={conversationId}
        api={api}
        generation={generation}
        isOwner={isOwner}
      />
    )
  }

  return (
    <InboxList
      tenantId={tenantId}
      api={api}
      generation={generation}
      viewerClerkUserId={viewerId}
    />
  )
}

/** Resolve contactId a partir da conversa quando a rota é …/:id/contato. */
function ContactViaConversation({
  tenantId,
  conversationId,
  api,
  generation,
  isOwner,
}: {
  tenantId: string
  conversationId: string
  api: NonNullable<ReturnType<typeof useAuthSession>['api']>
  generation: number
  isOwner: boolean
}) {
  const [contactId, setContactId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void api
      .getInboxConversation(tenantId, conversationId, {}, {
        generation,
        expectGeneration: () => generation,
      })
      .then((d) => {
        if (!cancelled) setContactId(d.contactId)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(friendlyError(err, 'Não deu para concluir agora. Tente de novo.'))
        }
      })
    return () => {
      cancelled = true
    }
  }, [api, tenantId, conversationId, generation])

  if (error) {
    return <ErrorState title="Contato indisponível" description={error} />
  }
  if (!contactId) return <LoadingState label="Abrindo contato…" />
  return (
    <InboxContactScreen
      tenantId={tenantId}
      contactId={contactId}
      conversationId={conversationId}
      api={api}
      generation={generation}
      isOwner={isOwner}
    />
  )
}
