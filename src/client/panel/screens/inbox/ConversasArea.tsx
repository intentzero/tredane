import { MessageCircle, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAuthSession } from '../../auth/AuthContext'
import { useTenant } from '../../tenant/TenantContext'
import { ErrorState, LoadingState } from '../../states/StatusScreens'
import type { ConversasSection } from '../../routes'
import { InboxContactScreen } from './InboxContact'
import { InboxList } from './InboxList'
import { InboxThread } from './InboxThread'
import { AgendarScreen } from '../agenda/AgendarScreen'
import { ShellIdentity, useOnline } from '../../shell/ShellIdentity'
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
  const wide = useWideLayout()
  if (section === 'thread' && conversationId) {
    const thread = (
      <InboxThread
        tenantId={tenantId}
        conversationId={conversationId}
        api={api}
        generation={generation}
        viewerClerkUserId={viewerId}
      />
    )
    if (!wide) return thread
    return (
      <ConversasThreeCol
        tenantId={tenantId}
        conversationId={conversationId}
        api={api}
        generation={generation}
        viewerId={viewerId}
        isOwner={isOwner}
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

  if (wide) {
    return (
      <ConversasThreeCol
        tenantId={tenantId}
        api={api}
        generation={generation}
        viewerId={viewerId}
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

/** Abaixo disto o painel do contato abre fechado (acima, abre aberto). */
export const CONTACT_INLINE_QUERY = '(min-width: 1280px)'

const PANEL_KEY = 'tredane.contactPanel'

function readPanelPref(): 'open' | 'closed' | null {
  try {
    const v = window.localStorage.getItem(PANEL_KEY)
    return v === 'open' || v === 'closed' ? v : null
  } catch {
    return null
  }
}

function writePanelPref(v: 'open' | 'closed') {
  try {
    window.localStorage.setItem(PANEL_KEY, v)
  } catch {
    /* sem armazenamento: a escolha vale só nesta sessão */
  }
}

/**
 * Desktop: lista · conversa, com o contato num painel que desliza da direita por cima
 * (380 px, sem véu: a conversa e a lista continuam utilizáveis). Ao abrir, a coluna de
 * leitura desliza para a esquerda para não esconder mensagens nem o campo de escrita.
 * Abre aberto a partir de 1280 px e fechado abaixo; a escolha da pessoa fica lembrada.
 */
export function ConversasThreeCol({
  tenantId,
  conversationId,
  api,
  generation,
  viewerId,
  isOwner,
}: {
  tenantId: string
  /** Sem conversa aberta (`/conversas`), a área de trabalho mostra um estado vazio. */
  conversationId?: string
  api: NonNullable<ReturnType<typeof useAuthSession>['api']>
  generation: number
  viewerId: string
  isOwner: boolean
}) {
  const roomy = useMediaQuery(CONTACT_INLINE_QUERY)
  const [pref, setPref] = useState<'open' | 'closed' | null>(readPanelPref)
  const hasThread = Boolean(conversationId)
  // DEC-074: o Agendar ocupa o lugar do contato; ao fechar, o contato volta ao que a pessoa lembrou.
  const [agendarOpen, setAgendarOpen] = useState(false)
  const panelOpen = hasThread && !agendarOpen && (pref ? pref === 'open' : roomy)
  // O conteúdo só é buscado na primeira abertura; depois fica montado (escondido).
  const [everOpened, setEverOpened] = useState(false)
  const asideRef = useRef<HTMLElement | null>(null)
  const agendarRef = useRef<HTMLElement | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const agendarReturnFocus = useRef<HTMLElement | null>(null)
  const userToggled = useRef(false)

  // Trocar de conversa fecha o Agendar: o painel nunca marca para a pessoa errada.
  useEffect(() => {
    setAgendarOpen(false)
  }, [conversationId])

  const toggleAgendar = () => {
    if (agendarOpen) {
      setAgendarOpen(false)
    } else {
      agendarReturnFocus.current = document.activeElement as HTMLElement | null
      setAgendarOpen(true)
    }
  }

  useEffect(() => {
    if (agendarOpen) agendarRef.current?.focus({ preventScroll: true })
    else agendarReturnFocus.current?.focus?.({ preventScroll: true })
  }, [agendarOpen])

  useEffect(() => {
    if (!agendarOpen) return
    const onKey = (e: KeyboardEvent) => {
      // Esc dentro da folha de revisão fecha só a folha.
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) setAgendarOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [agendarOpen])

  useEffect(() => {
    if (panelOpen) setEverOpened(true)
  }, [panelOpen])

  const setOpen = (next: boolean) => {
    userToggled.current = true
    returnFocus.current = next ? (document.activeElement as HTMLElement | null) : returnFocus.current
    setPref(next ? 'open' : 'closed')
    writePanelPref(next ? 'open' : 'closed')
  }

  // Foco: ao abrir pela pessoa vai para o painel; ao fechar volta ao controlo que o abriu.
  useEffect(() => {
    if (!userToggled.current) return
    if (panelOpen) {
      asideRef.current?.focus({ preventScroll: true })
    } else {
      returnFocus.current?.focus?.({ preventScroll: true })
    }
  }, [panelOpen])

  useEffect(() => {
    if (!panelOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panelOpen])

  return (
    <div
      className={`conversas-3col${hasThread ? '' : ' conversas-3col--empty'}`}
      data-contact={!hasThread ? 'none' : panelOpen ? 'open' : 'closed'}
      data-agendar={agendarOpen ? 'open' : undefined}
    >
      <div className="conversas-3col-list">
        <ConversasListHead />
        <InboxList
          tenantId={tenantId}
          api={api}
          generation={generation}
          viewerClerkUserId={viewerId}
          activeConversationId={conversationId}
        />
      </div>
      <div className="conversas-3col-thread">
        {!hasThread ? <ConversasEmptyPane /> : null}
        {conversationId ? (
          <InboxThread
            tenantId={tenantId}
            conversationId={conversationId}
            api={api}
            generation={generation}
            viewerClerkUserId={viewerId}
            contactPanel={{
              open: panelOpen,
              controlsId: 'conversas-contact-panel',
              onToggle: () => {
                if (agendarOpen) {
                  setAgendarOpen(false)
                  setOpen(true)
                } else {
                  setOpen(!panelOpen)
                }
              },
            }}
            agendarPanel={{
              open: agendarOpen,
              controlsId: 'conversas-agendar-panel',
              onToggle: toggleAgendar,
            }}
          />
        ) : null}
      </div>
      {hasThread && conversationId && (panelOpen || everOpened) ? (
        <aside
          id="conversas-contact-panel"
          ref={asideRef}
          tabIndex={-1}
          className="conversas-3col-contact"
          aria-label="Contato"
          aria-hidden={panelOpen ? undefined : true}
          inert={!panelOpen}
        >
          <div className="conversas-contact-head">
            <button
              type="button"
              className="panel-icon-btn"
              aria-label="Fechar contato"
              onClick={() => setOpen(false)}
            >
              <X aria-hidden size={20} strokeWidth={2} />
            </button>
          </div>
          <ContactViaConversation
            tenantId={tenantId}
            conversationId={conversationId}
            api={api}
            generation={generation}
            isOwner={isOwner}
          />
        </aside>
      ) : null}
      {hasThread && conversationId && agendarOpen ? (
        <ConversasAgendarPanel
          asideRef={agendarRef}
          tenantId={tenantId}
          conversationId={conversationId}
          api={api}
          generation={generation}
          onClose={() => setAgendarOpen(false)}
        />
      ) : null}
    </div>
  )
}

/** DEC-074: o contato da conversa vem da própria conversa; o Agendar não lê a URL. */
function ConversasAgendarPanel({
  asideRef,
  tenantId,
  conversationId,
  api,
  generation,
  onClose,
}: {
  asideRef: React.MutableRefObject<HTMLElement | null>
  tenantId: string
  conversationId: string
  api: NonNullable<ReturnType<typeof useAuthSession>['api']>
  generation: number
  onClose: () => void
}) {
  const [contactId, setContactId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void api
      .getInboxConversation(tenantId, conversationId, { messageLimit: 1 }, {
        generation,
        expectGeneration: () => generation,
      })
      .then((d) => {
        if (!cancelled) setContactId(d.contactId)
      })
      .catch((err) => {
        if (!cancelled) setError(friendlyError(err, 'Não deu para abrir o Agendar agora. Tente de novo.'))
      })
    return () => {
      cancelled = true
    }
  }, [api, tenantId, conversationId, generation])

  return (
    <aside
      id="conversas-agendar-panel"
      ref={asideRef}
      tabIndex={-1}
      className="conversas-3col-agendar"
      aria-label="Agendar horário"
    >
      {error ? (
        <ErrorState title="Agendar indisponível" description={error} actionLabel="Fechar" onAction={onClose} />
      ) : !contactId ? (
        <LoadingState label="Abrindo o Agendar…" />
      ) : (
        <AgendarScreen
          tenantId={tenantId}
          api={api}
          generation={generation}
          embedded={{ conversationId, contactId, onClose }}
        />
      )}
    </aside>
  )
}

const WIDE_QUERY = '(min-width: 1024px)'

function useMediaQuery(query: string): boolean {
  const get = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false
  const [m, setM] = useState(get)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(query)
    const on = () => setM(mq.matches)
    on()
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [query])
  return m
}

/** Desktop largo → 3 colunas. No celular nada muda (e não busca lista/contato a mais). */
function useWideLayout(): boolean {
  const get = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(WIDE_QUERY).matches
      : false
  const [wide, setWide] = useState(get)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(WIDE_QUERY)
    const on = () => setWide(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return wide
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

/**
 * Topo da coluna da lista no desktop largo (≥ 1280 px): título, clínica ativa e «Ao vivo».
 * O cabeçalho do shell some nesse tamanho, então a identidade fica aqui.
 */
function ConversasListHead() {
  const { active, listState } = useTenant()
  const online = useOnline()
  if (active.phase !== 'ready') return null
  const ctx = active.context
  return (
    <div className="conversas-list-head">
      <h1 className="panel-title-lg">Conversas</h1>
      <ShellIdentity
        tenantId={ctx.tenantId}
        name={ctx.name}
        area="conversas"
        tenants={listState.phase === 'ready' ? listState.tenants : []}
        offline={!online}
      />
    </div>
  )
}

/** Área de trabalho de `/conversas` sem conversa aberta: a moldura não muda ao abrir uma. */
function ConversasEmptyPane() {
  return (
    <div className="conversas-empty-pane">
      <MessageCircle aria-hidden size={28} strokeWidth={2} />
      <h2>Escolha uma conversa</h2>
      <p>A lista fica no mesmo lugar quando uma conversa abre.</p>
    </div>
  )
}
