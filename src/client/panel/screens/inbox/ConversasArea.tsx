import { useEffect, useState } from 'react'
import { useAuthSession } from '../../auth/AuthContext'
import { useTenant } from '../../tenant/TenantContext'
import { ErrorState, LoadingState } from '../../states/StatusScreens'
import type { ConversasSection } from '../../routes'
import { InboxContactScreen } from './InboxContact'
import { InboxList } from './InboxList'
import { InboxThread } from './InboxThread'

type Props = {
  tenantId: string
  section: ConversasSection
  conversationId?: string
  contactId?: string
}

/**
 * Área Conversas (#29): lista partilhada, thread e ficha do contacto.
 * Sem Acompanhamento (#30) nem webhooks WhatsApp (F3).
 */
export function ConversasArea({
  tenantId,
  section,
  conversationId,
  contactId,
}: Props) {
  const { api, status } = useAuthSession()
  const { generation } = useTenant()
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
    return <LoadingState label="A preparar sessão…" />
  }
  if (!viewerId) {
    return <LoadingState label="A identificar utilizador…" />
  }

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
        />
      )
    }
    if (!resolvedContactId) {
      return (
        <ErrorState
          title="Contacto em falta"
          description="Não foi possível abrir as informações do contacto."
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
}: {
  tenantId: string
  conversationId: string
  api: NonNullable<ReturnType<typeof useAuthSession>['api']>
  generation: number
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
          setError(err instanceof Error ? err.message : 'Falha')
        }
      })
    return () => {
      cancelled = true
    }
  }, [api, tenantId, conversationId, generation])

  if (error) {
    return <ErrorState title="Contacto indisponível" description={error} />
  }
  if (!contactId) return <LoadingState label="A abrir contacto…" />
  return (
    <InboxContactScreen
      tenantId={tenantId}
      contactId={contactId}
      conversationId={conversationId}
      api={api}
      generation={generation}
    />
  )
}
