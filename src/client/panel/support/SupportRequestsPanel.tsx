/**
 * Pedidos de suporte do Tredane vistos pela responsável (TEL-10 / M-27, DEC-029 a DEC-032, #897).
 * Faixa no topo de Equipe com o prazo; «Ver pedido» abre o detalhe com Aprovar e Rejeitar.
 * Qualquer responsável decide e a primeira decisão vale (DEC-030): quem chega depois vê a frase do servidor.
 * O pedido só traz ids do Clerk: o nome de quem representa vem da lista da Equipe; quem pede é «a equipe do Tredane».
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import type { PanelApi, SupportRequestLite, TeamMemberLite } from '../api'
import { PanelApiError } from '../api'
import { friendlyError } from '../copy/errors'
import { Banner } from '../states/Banner'

const POLL_MS = 30_000

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
  /** Membros da Equipe, para nomear a pessoa em nome de quem o suporte lê. */
  members: TeamMemberLite[]
  /** Pedido do link do e-mail: abre o detalhe sozinho quando ainda está pendente. */
  openRequestId?: string
  /** Muda quando chega um evento em tempo real; relê a lista. */
  refreshKey?: number
  /** Frase de sucesso para a tela mostrar («Suporte aprovado…»). */
  onDecided?: (message: string) => void
}

export function remainingLabel(expiresAt: number, nowMs: number): string {
  const ms = expiresAt - nowMs
  if (ms <= 0) return 'expirou'
  const mins = Math.ceil(ms / 60_000)
  if (mins < 60) return mins === 1 ? 'expira em 1 min' : `expira em ${mins} min`
  const hours = Math.floor(mins / 60)
  const rest = mins % 60
  return rest === 0 ? `expira em ${hours} h` : `expira em ${hours} h ${rest} min`
}

function personName(m: TeamMemberLite | undefined): string {
  return m?.displayName?.trim() || m?.email?.trim() || 'uma pessoa da clínica'
}

function roleLabel(role: string | undefined): string {
  return role === 'owner' ? 'Responsável' : 'Atendente'
}

export function SupportRequestsPanel({
  tenantId,
  api,
  generation,
  members,
  openRequestId,
  refreshKey = 0,
  onDecided,
}: Props) {
  const [requests, setRequests] = useState<SupportRequestLite[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [decisionError, setDecisionError] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [autoOpened, setAutoOpened] = useState(false)

  const load = useCallback(async () => {
    try {
      const { requests: rows } = await api.listSupportRequests(tenantId, undefined, {
        generation,
        expectGeneration: () => generation,
      })
      setRequests(rows)
      setLoadError(false)
    } catch (err) {
      if (err instanceof PanelApiError && err.message === 'stale_tenant_response') return
      // Sem lista não há faixa, mas isto não pode esconder o resto da Equipe: avisa uma vez, sem bloquear.
      setLoadError(true)
    }
  }, [api, tenantId, generation])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMs(Date.now())
      void load()
    }, POLL_MS)
    return () => window.clearInterval(id)
  }, [load])

  const pending = useMemo(
    () => (requests ?? []).filter((r) => r.status === 'pending' && r.expiresAt > nowMs),
    [requests, nowMs],
  )
  const byId = useMemo(() => new Map(members.map((m) => [m.clerkUserId, m])), [members])

  // Link do e-mail: abre o detalhe uma vez, se o pedido ainda espera decisão.
  useEffect(() => {
    if (autoOpened || !openRequestId || requests === null) return
    setAutoOpened(true)
    if (pending.some((r) => r.id === openRequestId)) setOpenId(openRequestId)
  }, [autoOpened, openRequestId, requests, pending])

  const open = pending.find((r) => r.id === openId) ?? null
  const linked = openRequestId ? (requests ?? []).find((r) => r.id === openRequestId) : undefined
  const linkedGone = Boolean(openRequestId) && requests !== null && !pending.some((r) => r.id === openRequestId)

  const decide = async (request: SupportRequestLite, decision: 'approve' | 'reject') => {
    setBusy(decision)
    setDecisionError(null)
    const subject = personName(byId.get(request.subjectClerkUserId))
    try {
      await api.decideSupportRequest(tenantId, request.id, decision, {
        generation,
        expectGeneration: () => generation,
      })
      setOpenId(null)
      onDecided?.(
        decision === 'approve'
          ? `Suporte aprovado. A equipe do Tredane já pode entrar, só para ler, como ${subject}, por 30 minutos.`
          : 'Pedido de suporte rejeitado. Nada foi aberto.',
      )
    } catch (err) {
      setDecisionError(friendlyError(err, 'Não foi possível registrar a decisão. Tente de novo.'))
    } finally {
      setBusy(null)
      void load()
    }
  }

  return (
    <>
      {loadError && requests === null ? (
        <Banner tone="warn" title="Não deu para ver os pedidos de suporte">
          <p>Os pedidos do Tredane não carregaram. Recarregue a página para tentar de novo.</p>
        </Banner>
      ) : null}

      {linkedGone ? (
        <Banner tone="info" title="Este pedido já não espera decisão">
          <p>
            {linked?.status === 'approved'
              ? 'Outra pessoa responsável já aprovou. A primeira decisão vale.'
              : linked?.status === 'rejected'
                ? 'Outra pessoa responsável já rejeitou. A primeira decisão vale.'
                : linked?.status === 'cancelled'
                  ? 'O Tredane cancelou o pedido.'
                  : 'O prazo de 24 h acabou. O Tredane precisa de fazer um novo pedido.'}
          </p>
        </Banner>
      ) : null}

      {open === null && decisionError ? (
        <Banner tone="error" title="Não deu certo">
          <p>{decisionError}</p>
        </Banner>
      ) : null}

      {pending.map((r) => (
        <Banner
          key={r.id}
          tone="warn"
          role="status"
          title="O Tredane pediu para ler as conversas desta clínica"
          action={
            <Button className="panel-btn panel-btn-primary" onPress={() => {
              setDecisionError(null)
              setOpenId(r.id)
            }}>
              Ver pedido
            </Button>
          }
        >
          <p>
            Aguardando sua decisão: {remainingLabel(r.expiresAt, nowMs)}. Sem aprovação não há acesso.
          </p>
        </Banner>
      ))}

      <ModalOverlay
        isOpen={open !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen && busy === null) setOpenId(null)
        }}
        isDismissable={busy === null}
        className="panel-overlay panel-choice-overlay"
      >
        <Modal className="panel-choice-modal">
          <Dialog
            className="panel-sheet panel-choice-sheet"
            aria-labelledby="support-request-title"
          >
            <span className="panel-sheet-handle" aria-hidden="true" />
            <Heading slot="title" id="support-request-title" className="panel-title panel-choice-title">
              Pedido de suporte
            </Heading>
            {open ? (
              <>
                <p role="status" className="panel-subtitle">
                  Aguardando sua decisão: {remainingLabel(open.expiresAt, nowMs)}. Depois disso é preciso um novo pedido.
                </p>
                <dl className="support-request-details">
                  <dt>Quem pede</dt>
                  <dd>Equipe do Tredane</dd>
                  <dt>Em nome de</dt>
                  <dd>
                    {personName(byId.get(open.subjectClerkUserId))}{' '}
                    <span className="panel-subtitle">({roleLabel(byId.get(open.subjectClerkUserId)?.role)})</span>
                  </dd>
                  <dt>Motivo</dt>
                  <dd>{open.reason}</dd>
                  <dt>O que poderá</dt>
                  <dd>
                    Ler as conversas e os contatos desta clínica, só o que essa pessoa já pode ver. Os telefones
                    aparecem só com os 4 últimos dígitos. Não altera nada.
                  </dd>
                  <dt>Duração</dt>
                  <dd>30 minutos desde a ativação. Não prorroga.</dd>
                </dl>
                <ul className="support-request-notes">
                  <li>Qualquer responsável da clínica pode decidir. A primeira decisão vale.</li>
                  <li>Durante o suporte você e a pessoa representada veem um aviso, e você pode encerrar a qualquer momento.</li>
                  <li>Cada leitura fica registada.</li>
                </ul>
                {decisionError ? (
                  <Banner tone="error" title="Não deu certo">
                    <p>{decisionError}</p>
                  </Banner>
                ) : null}
                <div className="clinic-footer-actions" style={{ flexDirection: 'column', gap: 8 }}>
                  <Button
                    className="panel-btn panel-btn-primary"
                    isDisabled={busy !== null}
                    onPress={() => void decide(open, 'approve')}
                  >
                    {busy === 'approve' ? 'Aprovando…' : 'Aprovar suporte'}
                  </Button>
                  <Button
                    className="panel-btn panel-btn-danger"
                    isDisabled={busy !== null}
                    onPress={() => void decide(open, 'reject')}
                  >
                    {busy === 'reject' ? 'Rejeitando…' : 'Rejeitar'}
                  </Button>
                  <Button className="panel-btn panel-btn-ghost" isDisabled={busy !== null} onPress={() => setOpenId(null)}>
                    Decidir depois
                  </Button>
                </div>
              </>
            ) : null}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </>
  )
}
