import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Eye, ShieldAlert } from 'lucide-react'
import {
  PanelApiError,
  type InboxConversation,
  type InboxConversationDetail,
  type PanelApi,
  type TenantContextResponse,
} from '../api'
import { Banner } from '../states/Banner'
import { AccessEndedState, ErrorState, LoadingState } from '../states/StatusScreens'

/** Revalida a sessão no servidor com esta cadência; o relógio local só serve de contagem decrescente. */
const REVALIDATE_MS = 30_000

type Props = {
  context: TenantContextResponse & { support: { sessionId: string; expiresAt: number } }
  api: PanelApi
  /** Para testes e para a navegação: onde fica o Platform Admin. */
  goToAdmin?: () => void
  now?: () => number
}

export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Códigos do servidor que significam «a sessão acabou ou deixou de valer». */
function sessionGone(err: unknown): boolean {
  return err instanceof PanelApiError && (err.status === 401 || err.status === 403 || err.status === 409)
}

function fmtDate(ms: number | null): string {
  if (!ms) return ''
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms))
}

/**
 * Modo de suporte do Clinic App (ADR-0017 §5, DEC-195): vista **própria** só de leitura. Não monta as áreas
 * normais do painel — assim nenhum botão de escrita existe nesta sessão e não há chamadas fora da lista de
 * leitura do servidor (que as recusaria de qualquer forma).
 */
export function SupportView({ context, api, goToAdmin, now = Date.now }: Props) {
  const { sessionId, expiresAt } = context.support
  const [tick, setTick] = useState(now())
  const [ended, setEnded] = useState(false)
  const [ending, setEnding] = useState(false)
  const [endError, setEndError] = useState(false)
  const [list, setList] = useState<
    { phase: 'loading' } | { phase: 'error' } | { phase: 'ready'; items: InboxConversation[] }
  >({ phase: 'loading' })
  const [selected, setSelected] = useState<string | null>(null)
  const [thread, setThread] = useState<
    { phase: 'idle' } | { phase: 'loading' } | { phase: 'error' } | { phase: 'ready'; data: InboxConversationDetail }
  >({ phase: 'idle' })
  const endedRef = useRef(false)

  const markEnded = useCallback(() => {
    endedRef.current = true
    setEnded(true)
  }, [])

  // Contagem decrescente: ao chegar a zero a sessão acabou, sem esperar pelo servidor.
  useEffect(() => {
    const id = window.setInterval(() => setTick(now()), 1000)
    return () => window.clearInterval(id)
  }, [now])
  const remaining = expiresAt - tick
  useEffect(() => {
    if (remaining <= 0) markEnded()
  }, [remaining, markEnded])

  // Revalidação periódica: a revogação pelo owner ou pela actor chega aqui como 401/403/409.
  useEffect(() => {
    if (ended) return
    const id = window.setInterval(() => {
      api.getTenantContext(context.tenantId).catch((err) => {
        if (sessionGone(err)) markEnded()
      })
    }, REVALIDATE_MS)
    return () => window.clearInterval(id)
  }, [api, context.tenantId, ended, markEnded])

  useEffect(() => {
    if (ended) return
    const ac = new AbortController()
    api
      .listInboxConversations(context.tenantId, {}, { signal: ac.signal })
      .then((r) => setList({ phase: 'ready', items: r.conversations }))
      .catch((err) => {
        if (ac.signal.aborted) return
        if (sessionGone(err)) markEnded()
        else setList({ phase: 'error' })
      })
    return () => ac.abort()
  }, [api, context.tenantId, ended, markEnded])

  useEffect(() => {
    if (!selected || ended) return
    const ac = new AbortController()
    setThread({ phase: 'loading' })
    api
      .getInboxConversation(context.tenantId, selected, {}, { signal: ac.signal })
      .then((data) => setThread({ phase: 'ready', data }))
      .catch((err) => {
        if (ac.signal.aborted) return
        if (sessionGone(err)) markEnded()
        else setThread({ phase: 'error' })
      })
    return () => ac.abort()
  }, [api, context.tenantId, selected, ended, markEnded])

  const back = useMemo(() => goToAdmin ?? (() => window.location.assign('/admin')), [goToAdmin])

  async function endSession() {
    setEnding(true)
    setEndError(false)
    try {
      await api.endSupportSession(sessionId)
      markEnded()
    } catch (err) {
      // Já encerrada por outra via: o resultado pretendido está atingido.
      if (sessionGone(err)) markEnded()
      else setEndError(true)
    } finally {
      setEnding(false)
    }
  }

  if (ended) {
    return (
      <div className="panel-app support-view" lang="pt-BR">
        <AccessEndedState
          title="Sessão de suporte encerrada"
          description="O acesso a esta clínica terminou. Nenhum dado continua a ser apresentado."
          actionLabel="Voltar ao Platform Admin"
          onAction={back}
        />
      </div>
    )
  }

  const low = remaining <= 5 * 60_000
  return (
    <div className="panel-app support-view" lang="pt-BR" data-support-readonly="true">
      <section className="support-banner" aria-label="Sessão de suporte">
        <ShieldAlert aria-hidden="true" size={20} strokeWidth={2} />
        <p className="support-banner-text">
          <strong>Sessão de suporte · somente leitura</strong>
          <span>
            {' '}
            {context.name} · restam{' '}
            <time className={low ? 'support-banner-low' : undefined} dateTime={`PT${Math.ceil(remaining / 1000)}S`}>
              {formatRemaining(remaining)}
            </time>
          </span>
        </p>
        <button type="button" className="support-banner-end" onClick={endSession} disabled={ending}>
          {ending ? 'Encerrando…' : 'Encerrar sessão'}
        </button>
      </section>
      <p className="support-sr-status" role="status">
        {low ? 'A sessão de suporte termina em menos de 5 minutos.' : ''}
      </p>
      {endError ? (
        <Banner tone="error" title="Não foi possível encerrar a sessão">
          Tente de novo. A sessão acaba sozinha ao fim do prazo.
        </Banner>
      ) : null}

      <main id="panel-main" tabIndex={-1} className="support-main">
        <h1 className="panel-title-lg">Conversas</h1>
        <p className="support-note">
          <Eye aria-hidden="true" size={16} strokeWidth={2} /> Telefones aparecem com os últimos 4 dígitos. Nada aqui
          pode ser alterado.
        </p>
        <div className="support-columns">
          <nav aria-label="Conversas da clínica" className="support-list">
            {list.phase === 'loading' ? <LoadingState label="Carregando conversas…" /> : null}
            {list.phase === 'error' ? (
              <ErrorState
                title="Não foi possível carregar as conversas"
                description="Verifique a internet e tente de novo."
                actionLabel="Tentar de novo"
                onAction={() => setList({ phase: 'loading' })}
              />
            ) : null}
            {list.phase === 'ready' && list.items.length === 0 ? <p>Sem conversas nesta clínica.</p> : null}
            {list.phase === 'ready' ? (
              <ul>
                {list.items.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="support-conv"
                      aria-current={selected === c.id ? 'true' : undefined}
                      onClick={() => setSelected(c.id)}
                    >
                      <span className="support-conv-name">{c.contact.displayName ?? c.contact.waId}</span>
                      <span className="support-conv-preview">{c.lastMessagePreview ?? ''}</span>
                      <span className="support-conv-when">{fmtDate(c.lastMessageAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </nav>

          <section className="support-thread" aria-label="Mensagens da conversa">
            {thread.phase === 'idle' ? <p>Escolha uma conversa para ler.</p> : null}
            {thread.phase === 'loading' ? <LoadingState label="Carregando mensagens…" /> : null}
            {thread.phase === 'error' ? <p role="alert">Não foi possível carregar esta conversa.</p> : null}
            {thread.phase === 'ready' ? (
              <ol className="support-messages">
                {[...thread.data.messages]
                  .sort((a, b) => a.createdAt - b.createdAt)
                  .map((m) => (
                    <li key={m.id} className={`support-msg support-msg-${m.direction}`}>
                      <span className="support-msg-meta">
                        {m.direction === 'inbound' ? 'Cliente' : m.direction === 'outbound' ? 'Equipe' : 'Sistema'}
                        {' · '}
                        {fmtDate(m.createdAt)}
                      </span>
                      <span className="support-msg-body">{m.body}</span>
                    </li>
                  ))}
              </ol>
            ) : null}
          </section>
        </div>
      </main>
    </div>
  )
}
