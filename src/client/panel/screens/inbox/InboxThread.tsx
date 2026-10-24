import { ChevronLeft, Sparkles } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Button, TextArea, TextField } from 'react-aria-components'
import type {
  AiSuggestion,
  InboxConversationDetail,
  InboxMessage,
  PanelApi,
  PixChargeDetail,
  PixPaymentAlert,
  WhatsappTemplateItem,
} from '../../api'
import { navigatePanel } from '../../routes'
import { ErrorState, LoadingState } from '../../states/StatusScreens'
import {
  assigneeLine,
  contactLabel,
  deliveryLabel,
  statusClass,
  statusLabel,
} from './format'

type Props = {
  tenantId: string
  conversationId: string
  api: PanelApi
  generation: number
  viewerClerkUserId: string
}

/** Texto sempre como nó React — nunca HTML (XSS / conteúdo externo). */
function PlainText({ text }: { text: string }) {
  return <>{text}</>
}

function MessageBubble({
  m,
  onRetry,
  busy,
}: {
  m: InboxMessage
  onRetry?: (m: InboxMessage) => void
  busy: boolean
}) {
  if (m.direction === 'system') {
    return (
      <div className="inbox-msg-system" role="status">
        <PlainText text={m.body} />
      </div>
    )
  }
  const outbound = m.direction === 'outbound'
  const failed = outbound && m.deliveryState === 'failed'
  const unknown = outbound && m.deliveryState === 'unknown'
  return (
    <div
      className={outbound ? 'inbox-msg inbox-msg-out' : 'inbox-msg inbox-msg-in'}
    >
      <p className="inbox-msg-body">
        <PlainText text={m.body} />
      </p>
      <span className="inbox-msg-meta">
        {new Date(m.createdAt).toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        })}
        {outbound ? ` · ${deliveryLabel(m.deliveryState)}` : ''}
      </span>
      {failed && onRetry ? (
        <Button
          className="panel-btn-secondary inbox-msg-retry"
          onPress={() => onRetry(m)}
          isDisabled={busy}
        >
          Tentar de novo
        </Button>
      ) : null}
      {unknown ? (
        <span className="inbox-msg-unknown-hint" role="status">
          Sem nova tentativa até reconciliação
        </span>
      ) : null}
    </div>
  )
}

export function InboxThread({
  tenantId,
  conversationId,
  api,
  generation,
  viewerClerkUserId,
}: Props) {
  const [detail, setDetail] = useState<InboxConversationDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [templates, setTemplates] = useState<WhatsappTemplateItem[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [selectedTemplate, setSelectedTemplate] =
    useState<WhatsappTemplateItem | null>(null)
  const [pixCharges, setPixCharges] = useState<PixChargeDetail[]>([])
  const [pixAlerts, setPixAlerts] = useState<PixPaymentAlert[]>([])
  const [templateParams, setTemplateParams] = useState<Record<string, string>>(
    {},
  )
  const [aiSuggestion, setAiSuggestion] = useState<AiSuggestion | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiUnavailable, setAiUnavailable] = useState(false)
  const [activeSuggestionId, setActiveSuggestionId] = useState<string | null>(
    null,
  )
  const composerId = useId()

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.getInboxConversation(
        tenantId,
        conversationId,
        { messageLimit: 100 },
        { generation, expectGeneration: () => generation },
      )
      setDetail(res)
      if (res.unreadCount > 0) {
        void api
          .markInboxRead(tenantId, conversationId, {
            generation,
            expectGeneration: () => generation,
          })
          .then((r) =>
            setDetail((prev) =>
              prev ? { ...prev, ...r.conversation, messages: prev.messages } : prev,
            ),
          )
          .catch(() => {
            /* leitura best-effort */
          })
      }
      if (!res.messagingWindow?.open) {
        void api
          .listWhatsappTemplates(tenantId, {
            generation,
            expectGeneration: () => generation,
          })
          .then((t) => setTemplates(t.items))
          .catch(() => setTemplates([]))
      }
      void api
        .listConversationPixCharges(tenantId, conversationId, {
          generation,
          expectGeneration: () => generation,
        })
        .then(setPixCharges)
        .catch(() => setPixCharges([]))
      void api
        .listPixPaymentAlerts(tenantId, conversationId, {
          generation,
          expectGeneration: () => generation,
        })
        .then(setPixAlerts)
        .catch(() => setPixAlerts([]))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao abrir conversa')
      setDetail(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [tenantId, conversationId, generation])

  async function refundAlert(a: PixPaymentAlert) {
    setBusy(true)
    setNotice(null)
    try {
      const result = await api.refundPixAlert(
        tenantId,
        a.id,
        { clientRequestId: crypto.randomUUID() },
        { generation, expectGeneration: () => generation },
      )
      if (result.refundConfirmed) {
        setNotice('Sinal devolvido.')
        setPixAlerts((prev) => prev.filter((x) => x.id !== a.id))
      } else if (result.uncertain) {
        setNotice(
          'Estorno solicitado — a aguardar confirmação do provedor. Ainda não está devolvido.',
        )
      } else {
        setNotice(
          result.charge.status === 'refund_failed'
            ? 'Estorno falhou. Pode tentar de novo.'
            : 'Estorno solicitado.',
        )
      }
      void api
        .listConversationPixCharges(tenantId, conversationId, {
          generation,
          expectGeneration: () => generation,
        })
        .then(setPixCharges)
        .catch(() => {})
      void api
        .listPixPaymentAlerts(tenantId, conversationId, {
          generation,
          expectGeneration: () => generation,
        })
        .then(setPixAlerts)
        .catch(() => {})
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Falha ao devolver sinal')
    } finally {
      setBusy(false)
    }
  }

  async function cancelCharge(c: PixChargeDetail) {
    setBusy(true)
    setNotice(null)
    try {
      await api.cancelPixCharge(
        tenantId,
        c.id,
        { clientRequestId: crypto.randomUUID() },
        { generation, expectGeneration: () => generation },
      )
      setNotice('Cobrança cancelada.')
      setPixCharges((prev) =>
        prev.map((x) =>
          x.id === c.id ? { ...x, status: 'cancelled' } : x,
        ),
      )
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Falha ao cancelar cobrança')
    } finally {
      setBusy(false)
    }
  }

  async function assume() {
    if (!detail) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await api.assignInboxConversation(
        tenantId,
        conversationId,
        { expectedAssignmentVersion: detail.assignmentVersion },
        { generation, expectGeneration: () => generation },
      )
      if (res.versionMatched === false) {
        setNotice(
          `${res.conversation.assigneeDisplayName ?? 'Outra pessoa'} assumiu esta conversa antes de você.`,
        )
      }
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              ...res.conversation,
              messages: [...prev.messages, res.systemMessage],
            }
          : prev,
      )
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Falha ao assumir')
    } finally {
      setBusy(false)
    }
  }

  async function closeConv() {
    if (!detail) return
    setBusy(true)
    try {
      const res = await api.closeInboxConversation(tenantId, conversationId, {
        generation,
        expectGeneration: () => generation,
      })
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              ...res.conversation,
              messages: [...prev.messages, res.systemMessage],
            }
          : prev,
      )
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Falha ao encerrar')
    } finally {
      setBusy(false)
    }
  }

  async function requestAiSuggestion(parentSuggestionId?: string | null) {
    setAiBusy(true)
    setAiUnavailable(false)
    setNotice(null)
    try {
      const res = await api.suggestAiReply(
        tenantId,
        conversationId,
        {
          clientRequestId: crypto.randomUUID(),
          parentSuggestionId: parentSuggestionId ?? null,
          actorDisplayName: 'Atendente',
        },
        { generation, expectGeneration: () => generation },
      )
      if (res.suggestion.status === 'failed' || !res.suggestion.suggestedText) {
        setAiSuggestion(null)
        setAiUnavailable(true)
      } else {
        setAiSuggestion(res.suggestion)
        setAiUnavailable(false)
      }
    } catch {
      setAiSuggestion(null)
      setAiUnavailable(true)
    } finally {
      setAiBusy(false)
    }
  }

  async function discardAiSuggestion() {
    if (!aiSuggestion) {
      setAiSuggestion(null)
      return
    }
    setAiBusy(true)
    try {
      await api.decideAiSuggestion(
        tenantId,
        aiSuggestion.id,
        {
          clientRequestId: crypto.randomUUID(),
          decision: 'discard',
          actorDisplayName: 'Atendente',
        },
        { generation, expectGeneration: () => generation },
      )
    } catch {
      /* descarte local mesmo se a API falhar */
    } finally {
      setAiSuggestion(null)
      setActiveSuggestionId(null)
      setAiBusy(false)
    }
  }

  function useAndEditAiSuggestion() {
    if (!aiSuggestion) return
    setDraft(aiSuggestion.suggestedText)
    setActiveSuggestionId(aiSuggestion.id)
    setAiSuggestion(null)
  }

  async function sendPayload(payload: {
    body?: string
    template?: {
      name: string
      language: string
      params: Record<string, string>
    }
    aiSuggestionId?: string | null
  }) {
    if (!detail) return
    setBusy(true)
    setNotice(null)
    const clientRequestId = `client:${crypto.randomUUID()}`
    try {
      const res = await api.sendInboxMessage(
        tenantId,
        conversationId,
        {
          ...payload,
          clientRequestId,
          aiSuggestionId: payload.aiSuggestionId ?? activeSuggestionId,
        },
        { generation, expectGeneration: () => generation },
      )
      setDraft('')
      setActiveSuggestionId(null)
      setAiSuggestion(null)
      setSelectedTemplate(null)
      setTemplateParams({})
      setPickerOpen(false)
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              ...res.conversation,
              messages: res.duplicate
                ? prev.messages
                : [...prev.messages, res.message],
            }
          : prev,
      )
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Falha ao enviar')
    } finally {
      setBusy(false)
    }
  }

  async function send() {
    const body = draft.trim()
    if (!body || !detail) return
    if (!detail.messagingWindow?.open) {
      setNotice('Fora da janela de 24 h do WhatsApp — escolha um modelo aprovado')
      return
    }
    await sendPayload({ body })
  }

  async function sendTemplate() {
    if (!selectedTemplate) return
    for (const key of selectedTemplate.paramKeys) {
      if (!templateParams[key]?.trim()) {
        setNotice(`Preencha o parâmetro: ${key}`)
        return
      }
    }
    await sendPayload({
      template: {
        name: selectedTemplate.name,
        language: selectedTemplate.language,
        params: templateParams,
      },
    })
  }

  async function retryFailed(m: InboxMessage) {
    // Nova tentativa = nova intenção (REQ-013); não reutiliza clientRequestId.
    if (detail?.messagingWindow?.open) {
      await sendPayload({ body: m.body })
    } else {
      setNotice('Fora da janela — use um modelo para tentar de novo')
      setPickerOpen(true)
    }
  }

  if (loading && !detail) {
    return <LoadingState label="A abrir conversa…" />
  }
  if (error && !detail) {
    return (
      <ErrorState
        title="Conversa indisponível"
        description={error}
        actionLabel="Voltar à lista"
        onAction={() =>
          navigatePanel({
            kind: 'area',
            area: 'conversas',
            tenantId,
            section: 'lista',
          })
        }
      />
    )
  }
  if (!detail) return null

  const label = contactLabel(detail.contact)
  const isMine =
    detail.assigneeClerkUserId != null &&
    detail.assigneeClerkUserId === viewerClerkUserId
  const windowOpen = detail.messagingWindow?.open !== false

  return (
    <div className="inbox-thread">
      <header className="inbox-thread-header">
        <Button
          className="panel-icon-btn"
          aria-label="Voltar às conversas"
          onPress={() =>
            navigatePanel({
              kind: 'area',
              area: 'conversas',
              tenantId,
              section: 'lista',
            })
          }
        >
          <ChevronLeft aria-hidden size={22} strokeWidth={2} />
        </Button>
        <button
          type="button"
          className="inbox-thread-title"
          onClick={() =>
            navigatePanel({
              kind: 'area',
              area: 'conversas',
              tenantId,
              section: 'contato',
              conversationId: detail.id,
              contactId: detail.contactId,
            })
          }
        >
          <span className="inbox-thread-name">{label}</span>
          <span className="inbox-thread-sub">
            <span className={statusClass(detail.status)}>{statusLabel(detail.status)}</span>
            {' · '}
            {assigneeLine(detail, viewerClerkUserId)}
          </span>
        </button>
      </header>

      {notice ? (
        <div className="inbox-notice" role="status">
          {notice}
          {!isMine && detail.status !== 'closed' ? (
            <Button className="panel-btn-secondary" onPress={() => void assume()} isDisabled={busy}>
              Assumir mesmo assim
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="inbox-thread-actions">
        {!isMine && detail.status !== 'closed' ? (
          <Button
            className="panel-btn-primary"
            onPress={() => void assume()}
            isDisabled={busy}
          >
            {busy ? 'Assumindo…' : 'Assumir'}
          </Button>
        ) : null}
        {detail.status !== 'closed' ? (
          <Button
            className="panel-btn-secondary"
            onPress={() =>
              navigatePanel({
                kind: 'area',
                area: 'agenda',
                tenantId,
                section: 'agendar',
                conversationId,
                contactId: detail.contactId,
              })
            }
            isDisabled={busy}
          >
            Agendar
          </Button>
        ) : null}
        {detail.status !== 'closed' ? (
          <Button
            className="panel-btn-secondary"
            onPress={() => void closeConv()}
            isDisabled={busy}
          >
            Encerrar
          </Button>
        ) : null}
      </div>

      {pixAlerts.length > 0 ? (
        <div className="inbox-notice inbox-pix-alert" role="alert">
          {pixAlerts.map((a) => {
            const charge = pixCharges.find((c) => c.id === a.chargeId)
            const refundPending = charge?.status === 'refund_requested'
            const refundFailed = charge?.status === 'refund_failed'
            return (
              <div key={a.id} className="inbox-pix-card">
                <strong>Sinal pago, mas o horário foi ocupado</strong>
                <p>
                  {charge
                    ? (charge.amountCents / 100).toLocaleString('pt-BR', {
                        style: 'currency',
                        currency: 'BRL',
                      })
                    : 'Pagamento registado'}
                  {' · '}
                  {a.reason === 'payment_after_expiry'
                    ? 'pagamento após o prazo'
                    : a.reason === 'slot_occupied'
                      ? 'horário já reservado'
                      : 'não foi possível confirmar o horário'}
                  {refundPending
                    ? ' · estorno solicitado (ainda não devolvido)'
                    : refundFailed
                      ? ` · estorno falhou${charge?.refundFailureReason ? `: ${charge.refundFailureReason}` : ''}`
                      : ''}
                </p>
                <div className="clinic-actions">
                  <Button
                    className="panel-btn-primary"
                    onPress={() =>
                      navigatePanel({
                        kind: 'area',
                        area: 'agenda',
                        tenantId,
                        section: 'agendar',
                        conversationId,
                        contactId: detail?.contactId,
                        alertId: a.id,
                      })
                    }
                    isDisabled={busy || refundPending}
                  >
                    Escolher outro horário
                  </Button>
                  <Button
                    className="panel-btn-secondary"
                    onPress={() => void refundAlert(a)}
                    isDisabled={busy || refundPending}
                  >
                    {refundFailed ? 'Tentar devolver de novo' : 'Devolver sinal'}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      {pixCharges.some((c) => c.status === 'awaiting_payment') ? (
        <div className="inbox-notice" role="status">
          {pixCharges
            .filter((c) => c.status === 'awaiting_payment')
            .map((c) => (
              <div key={c.id} className="inbox-pix-card">
                <strong>Aguardando sinal</strong>
                <p>
                  {(c.amountCents / 100).toLocaleString('pt-BR', {
                    style: 'currency',
                    currency: 'BRL',
                  })}
                  {c.expiresAt
                    ? ` · prazo até ${new Date(c.expiresAt).toLocaleString('pt-BR')}`
                    : ''}
                  {' · horário não reservado'}
                </p>
                <div className="clinic-actions">
                  {c.pixCopyPaste ? (
                    <Button
                      className="panel-btn-secondary"
                      onPress={() => {
                        void navigator.clipboard?.writeText(c.pixCopyPaste!)
                        setNotice('Pix copiado')
                      }}
                    >
                      Copiar Pix
                    </Button>
                  ) : null}
                  <Button
                    className="panel-btn-secondary"
                    onPress={() => void cancelCharge(c)}
                    isDisabled={busy}
                  >
                    Cancelar cobrança
                  </Button>
                </div>
                {c.whatsappSendError ? (
                  <p role="alert">Envio WhatsApp: {c.whatsappSendError}</p>
                ) : null}
              </div>
            ))}
        </div>
      ) : null}

      <div className="inbox-timeline" aria-live="polite">
        {detail.messagesHasMore ? (
          <p className="inbox-timeline-more">Há mensagens mais antigas no histórico.</p>
        ) : null}
        {detail.messages.map((m) => (
          <MessageBubble
            key={m.id}
            m={m}
            busy={busy}
            onRetry={m.deliveryState === 'failed' ? retryFailed : undefined}
          />
        ))}
      </div>

      {detail.status !== 'closed' ? (
        <div className="inbox-composer-wrap">
          {aiUnavailable ? (
            <div className="ai-block ai-block-unavailable" role="status">
              <p>A sugestão não está disponível agora. Você pode responder normalmente.</p>
            </div>
          ) : null}
          {aiSuggestion ? (
            <div className="ai-block" role="region" aria-label="Sugestão da IA">
              <p className="ai-block-label">Sugestão da IA — revise antes de enviar</p>
              {aiSuggestion.warningLabels.map((w) => (
                <p key={w} className="ai-block-warn" role="status">
                  {w}
                </p>
              ))}
              {aiSuggestion.sourceRefs.map((s) => (
                <p key={s.serviceName} className="ai-block-source">
                  {s.label}
                </p>
              ))}
              <p className="ai-block-text">
                <PlainText text={aiSuggestion.suggestedText} />
              </p>
              <div className="ai-block-actions">
                <Button
                  className="panel-btn-secondary ai-btn"
                  onPress={() => useAndEditAiSuggestion()}
                  isDisabled={aiBusy || busy}
                >
                  Usar e editar
                </Button>
                <Button
                  className="panel-btn-secondary ai-btn"
                  onPress={() => void requestAiSuggestion(aiSuggestion.id)}
                  isDisabled={aiBusy || busy}
                >
                  Gerar outra
                </Button>
                <Button
                  className="panel-btn-secondary ai-btn"
                  onPress={() => void discardAiSuggestion()}
                  isDisabled={aiBusy || busy}
                >
                  Descartar
                </Button>
              </div>
            </div>
          ) : null}
          {!windowOpen ? (
            <p className="inbox-window-banner" role="status">
              Fora da janela de 24 h do WhatsApp
            </p>
          ) : null}
          {windowOpen ? (
            <form
              className="inbox-composer"
              onSubmit={(e) => {
                e.preventDefault()
                void send()
              }}
            >
              <Button
                className="panel-icon-btn inbox-ai-trigger"
                aria-label="Sugerir resposta com IA"
                onPress={() => void requestAiSuggestion(null)}
                isDisabled={aiBusy || busy}
              >
                <Sparkles aria-hidden size={20} strokeWidth={2} />
              </Button>
              <TextField
                className="inbox-composer-field"
                aria-label="Mensagem"
                value={draft}
                onChange={setDraft}
              >
                <TextArea
                  id={composerId}
                  className="inbox-composer-input"
                  placeholder="Escreva uma resposta…"
                  rows={2}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault()
                      void send()
                    }
                  }}
                />
              </TextField>
              <Button
                className="panel-btn-primary"
                type="submit"
                isDisabled={busy || !draft.trim()}
              >
                Enviar
              </Button>
            </form>
          ) : (
            <div className="inbox-composer inbox-composer-template">
              <Button
                className="panel-btn-primary"
                onPress={() => {
                  setPickerOpen((o) => !o)
                  if (templates.length === 0) {
                    void api
                      .listWhatsappTemplates(tenantId, {
                        generation,
                        expectGeneration: () => generation,
                      })
                      .then((t) => setTemplates(t.items))
                  }
                }}
                isDisabled={busy}
              >
                Escolher modelo
              </Button>
            </div>
          )}

          {pickerOpen ? (
            <div className="inbox-template-picker" role="dialog" aria-label="Modelos WhatsApp">
              {templates.length === 0 ? (
                <p>Nenhum modelo aprovado sincronizado.</p>
              ) : (
                <ul className="inbox-template-list">
                  {templates.map((t) => (
                    <li key={`${t.name}:${t.language}`}>
                      <button
                        type="button"
                        className={
                          selectedTemplate?.name === t.name
                            ? 'inbox-template-item inbox-template-item-active'
                            : 'inbox-template-item'
                        }
                        onClick={() => {
                          setSelectedTemplate(t)
                          const next: Record<string, string> = {}
                          for (const k of t.paramKeys) next[k] = templateParams[k] ?? ''
                          setTemplateParams(next)
                        }}
                      >
                        <strong>{t.name}</strong>
                        <span>
                          {t.category}
                          {t.pricingCategory ? ` · ${t.pricingCategory}` : ''}
                        </span>
                        <span className="inbox-template-pricing">{t.pricingNote}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {selectedTemplate ? (
                <div className="inbox-template-form">
                  <p className="inbox-template-preview">
                    <PlainText text={selectedTemplate.bodyPreview} />
                  </p>
                  <p className="inbox-template-pricing" role="note">
                    {selectedTemplate.pricingNote}
                  </p>
                  {selectedTemplate.paramKeys.map((key) => (
                    <label key={key} className="inbox-template-param">
                      <span>{key}</span>
                      <input
                        value={templateParams[key] ?? ''}
                        onChange={(e) =>
                          setTemplateParams((prev) => ({
                            ...prev,
                            [key]: e.target.value,
                          }))
                        }
                      />
                    </label>
                  ))}
                  <Button
                    className="panel-btn-primary"
                    onPress={() => void sendTemplate()}
                    isDisabled={busy}
                  >
                    Enviar modelo
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="inbox-composer-closed">Conversa encerrada. Nova mensagem do contacto reabre o histórico.</p>
      )}
    </div>
  )
}
