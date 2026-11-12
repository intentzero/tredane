import { MessageCircle, X } from 'lucide-react'
import { useUser } from '@clerk/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Dialog, Modal, ModalOverlay } from 'react-aria-components'
import { useAuthSession } from '../../auth/AuthContext'
import {
  staffFirstNameFromDisplay,
  synthStaffFirstName,
} from '../../auth/staffDisplayName'
import { useTenant } from '../../tenant/TenantContext'
import { ErrorState, LoadingState } from '../../states/StatusScreens'
import type { ConversasSection } from '../../routes'
import { InboxContactScreen } from './InboxContact'
import { InboxList } from './InboxList'
import { InboxThread } from './InboxThread'
import { NeedsPersonAlerts } from './NeedsPersonAlerts'
import { AgendarScreen } from '../agenda/AgendarScreen'
import { ShellIdentity, useOnline } from '../../shell/ShellIdentity'
import { InboxRealtimeProvider } from '../../realtime/InboxRealtime'
import { friendlyError } from '../../copy/errors'
import { useOutsideClose } from '../../ui/useOutsideClose'
import { useVisualViewportSheet } from '../../ui/useVisualViewportSheet'
import { consumeAgendarOpen } from './agendarFocus'

type Props = {
  tenantId: string
  section: ConversasSection
  conversationId?: string
  contactId?: string
}

/** Só montar dentro de ClerkProvider (AUTH_MODE=clerk). */
function ClerkStaffDisplayName({
  children,
}: {
  children: (name: string | null) => ReactNode
}) {
  const { user } = useUser()
  const name = staffFirstNameFromDisplay(user?.firstName, user?.fullName)
  return <>{children(name)}</>
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
  const { api, status, authMode } = useAuthSession()
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

  const sectionView = (staffDisplayName: string | null) => (
    <NeedsPersonAlerts
      tenantId={tenantId}
      api={api}
      generation={generation}
      openConversationId={conversationId ?? null}
    >
      <ConversasSectionView
        tenantId={tenantId}
        section={section}
        conversationId={conversationId}
        contactId={contactId}
        api={api}
        generation={generation}
        viewerId={viewerId}
        isOwner={isOwner}
        staffDisplayName={staffDisplayName}
      />
    </NeedsPersonAlerts>
  )

  // Uma ligação WS por clínica enquanto a área Conversas está aberta.
  return (
    <InboxRealtimeProvider tenantId={tenantId} api={api} generation={generation}>
      {authMode === 'clerk' ? (
        <ClerkStaffDisplayName>
          {(clerkName) =>
            sectionView(clerkName ?? synthStaffFirstName(viewerId))
          }
        </ClerkStaffDisplayName>
      ) : (
        sectionView(synthStaffFirstName(viewerId))
      )}
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
  staffDisplayName,
}: Props & {
  api: NonNullable<ReturnType<typeof useAuthSession>['api']>
  generation: number
  viewerId: string
  isOwner: boolean
  staffDisplayName: string | null
}) {
  const wide = useWideLayout()
  if (section === 'thread' && conversationId) {
    if (!wide) {
      return (
        <MobileThread
          tenantId={tenantId}
          conversationId={conversationId}
          api={api}
          generation={generation}
          viewerId={viewerId}
          isOwner={isOwner}
          staffDisplayName={staffDisplayName}
        />
      )
    }
    return (
      <ConversasThreeCol
        tenantId={tenantId}
        conversationId={conversationId}
        api={api}
        generation={generation}
        viewerId={viewerId}
        isOwner={isOwner}
        staffDisplayName={staffDisplayName}
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
        staffDisplayName={staffDisplayName}
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
  staffDisplayName = null,
}: {
  tenantId: string
  /** Sem conversa aberta (`/conversas`), a área de trabalho mostra um estado vazio. */
  conversationId?: string
  api: NonNullable<ReturnType<typeof useAuthSession>['api']>
  generation: number
  viewerId: string
  isOwner: boolean
  /** DEC-088: nome de apresentação para o prefixo WhatsApp. */
  staffDisplayName?: string | null
}) {
  const roomy = useMediaQuery(CONTACT_INLINE_QUERY)
  const [pref, setPref] = useState<'open' | 'closed' | null>(readPanelPref)
  const hasThread = Boolean(conversationId)
  // DEC-074: o Agendar ocupa o lugar do contato; ao fechar, o contato volta ao que a pessoa lembrou.
  // DEC-162: Contato focado pode pedir o Agendar ao voltar à conversa (consumeAgendarOpen).
  const [agendarOpen, setAgendarOpen] = useState(() => consumeAgendarOpen())
  const panelOpen = hasThread && !agendarOpen && (pref ? pref === 'open' : roomy)
  // O conteúdo só é buscado na primeira abertura; depois fica montado (escondido).
  const [everOpened, setEverOpened] = useState(false)
  const asideRef = useRef<HTMLElement | null>(null)
  const agendarRef = useRef<HTMLElement | null>(null)
  useOutsideClose(asideRef, () => setOpen(false), hasThread && panelOpen)
  useOutsideClose(agendarRef, () => setAgendarOpen(false), agendarOpen)
  const returnFocus = useRef<HTMLElement | null>(null)
  const agendarReturnFocus = useRef<HTMLElement | null>(null)
  const userToggled = useRef(false)
  const agendarConversationId = useRef(conversationId)

  // Trocar de conversa fecha o Agendar: o painel nunca marca para a pessoa errada.
  // Não limpar no primeiro mount — senão apaga o pedido vindo do Contato (DEC-162).
  useEffect(() => {
    if (agendarConversationId.current === conversationId) return
    agendarConversationId.current = conversationId
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
            staffDisplayName={staffDisplayName}
            isOwner={isOwner}
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
            onAgendar={toggleAgendar}
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

/**
 * DEC-162 (M-69): no celular, Agendar abre em folha sobre a conversa — não troca de aba.
 * Fechar devolve à conversa no mesmo ponto.
 */
function MobileThread({
  tenantId,
  conversationId,
  api,
  generation,
  viewerId,
  isOwner,
  staffDisplayName,
}: {
  tenantId: string
  conversationId: string
  api: NonNullable<ReturnType<typeof useAuthSession>['api']>
  generation: number
  viewerId: string
  isOwner: boolean
  staffDisplayName: string | null
}) {
  // DEC-162: Contato focado no celular pede a folha Agendar ao voltar à conversa.
  const [agendarOpen, setAgendarOpen] = useState(() => consumeAgendarOpen())
  const sheetRef = useRef<HTMLElement | null>(null)
  const agendarConversationId = useRef(conversationId)
  // iOS: a folha usa 100dvh; com teclado sobe e encolhe ao visualViewport (mantém o vão space-8).
  const lift = useVisualViewportSheet(agendarOpen, { mode: 'lift' })
  const modalStyle =
    typeof lift.maxHeight === 'number'
      ? ({
          position: 'fixed' as const,
          left: 0,
          right: 0,
          bottom: lift.bottom ?? 0,
          // --space-8: vão superior sobre a conversa (ver .conversas-agendar-sheet-modal).
          height: `calc(${lift.maxHeight}px - var(--space-8))`,
          maxHeight: `calc(${lift.maxHeight}px - var(--space-8))`,
        } as const)
      : undefined
  useEffect(() => {
    if (agendarConversationId.current === conversationId) return
    agendarConversationId.current = conversationId
    setAgendarOpen(false)
  }, [conversationId])
  return (
    <>
      <InboxThread
        tenantId={tenantId}
        conversationId={conversationId}
        api={api}
        generation={generation}
        viewerClerkUserId={viewerId}
        staffDisplayName={staffDisplayName}
        isOwner={isOwner}
        agendarPanel={{
          open: agendarOpen,
          controlsId: 'conversas-agendar-sheet',
          onToggle: () => setAgendarOpen((o) => !o),
        }}
      />
      <ModalOverlay
        isOpen={agendarOpen}
        onOpenChange={setAgendarOpen}
        isDismissable
        className="panel-overlay conversas-agendar-sheet-overlay"
      >
        <Modal className="conversas-agendar-sheet-modal" style={modalStyle}>
          <Dialog className="conversas-agendar-sheet" aria-label="Agendar horário">
            <ConversasAgendarPanel
              asideRef={sheetRef}
              tenantId={tenantId}
              conversationId={conversationId}
              api={api}
              generation={generation}
              onClose={() => setAgendarOpen(false)}
              variant="sheet"
            />
          </Dialog>
        </Modal>
      </ModalOverlay>
    </>
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
  variant = 'aside',
}: {
  asideRef: React.MutableRefObject<HTMLElement | null>
  tenantId: string
  conversationId: string
  api: NonNullable<ReturnType<typeof useAuthSession>['api']>
  generation: number
  onClose: () => void
  /** `sheet`: folha no celular, com a última mensagem da cliente citada (DEC-162). */
  variant?: 'aside' | 'sheet'
}) {
  const [contactId, setContactId] = useState<string | null>(null)
  const [quote, setQuote] = useState<{ body: string; at: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void api
      .getInboxConversation(tenantId, conversationId, { messageLimit: variant === 'sheet' ? 20 : 1 }, {
        generation,
        expectGeneration: () => generation,
      })
      .then((d) => {
        if (cancelled) return
        setContactId(d.contactId)
        const lastIn = [...d.messages].reverse().find((m) => m.direction === 'inbound')
        setQuote(lastIn ? { body: lastIn.body, at: lastIn.createdAt } : null)
      })
      .catch((err) => {
        if (!cancelled) setError(friendlyError(err, 'Não deu para abrir o Agendar agora. Tente de novo.'))
      })
    return () => {
      cancelled = true
    }
  }, [api, tenantId, conversationId, generation, variant])

  return (
    <aside
      id={variant === 'sheet' ? 'conversas-agendar-sheet' : 'conversas-agendar-panel'}
      ref={asideRef}
      tabIndex={-1}
      className={variant === 'sheet' ? 'conversas-agendar-sheet-body' : 'conversas-3col-agendar'}
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
          embedded={{ conversationId, contactId, onClose, quote: quote?.body ?? null }}
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
  onAgendar,
}: {
  tenantId: string
  conversationId: string
  api: NonNullable<ReturnType<typeof useAuthSession>['api']>
  generation: number
  isOwner: boolean
  /** DEC-162 / DEC-074: Agendar no painel da conversa (desktop). */
  onAgendar?: () => void
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
      onAgendar={onAgendar}
    />
  )
}

/**
 * Topo da coluna da lista no desktop largo (≥ 1280 px): mesmo chrome do shell
 * (título + clínica com chevron + «Ao vivo»). Sino/conta ficam no rail.
 */
function ConversasListHead() {
  const { active, listState } = useTenant()
  const online = useOnline()
  if (active.phase !== 'ready') return null
  const ctx = active.context
  return (
    <div className="conversas-list-head">
      <div className="panel-shell-titles">
        <h1 className="panel-title-lg">Conversas</h1>
        <ShellIdentity
          tenantId={ctx.tenantId}
          name={ctx.name}
          area="conversas"
          tenants={listState.phase === 'ready' ? listState.tenants : []}
          offline={!online}
        />
      </div>
    </div>
  )
}

/** Área de trabalho de `/conversas` sem conversa aberta: a moldura não muda ao abrir uma. */
function ConversasEmptyPane() {
  return (
    <div className="conversas-empty-pane">
      <MessageCircle aria-hidden size={40} strokeWidth={1.6} />
      <h2>Escolha uma conversa</h2>
      <p>A lista fica no mesmo lugar quando uma conversa abre.</p>
    </div>
  )
}
