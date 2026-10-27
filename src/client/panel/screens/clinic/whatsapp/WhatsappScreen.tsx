/**
 * TEL-09 WhatsApp — M-19 / M-23 / M-24 / M-25 / M-26 (#31 / DEC-009 / REQ-051).
 * Embedded Signup: modo synthetic (fixtures) até gates Meta (#18).
 */
import { ChevronLeft, History, Repeat, Unplug } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Input, Label, TextField } from 'react-aria-components'
import type { PanelApi, WhatsappConnection, WhatsappSignupPurpose } from '../../../api'
import { PanelApiError } from '../../../api'
import { navigatePanel } from '../../../routes'
import { ErrorState, LoadingState } from '../../../states/StatusScreens'
import { TestOnly } from '../../../states/TestOnly'
import { useTenant } from '../../../tenant/TenantContext'
import {
  connectedByLabel,
  formatPhone,
  formatWhen,
  historyLabel,
  templateStatus,
  templateTitle,
} from './format'
import { useWhatsapp } from './useWhatsapp'
import { isStagingHostname, WhatsappDevSyncAction } from './WhatsappDevSyncAction'
import { friendlyError, friendlyReason } from '../../../copy/errors'
import { Badge } from '../../../states/Badge'
import { Banner } from '../../../states/Banner'
import { NavRow } from '../NavRow'

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
  mode: 'main' | 'trocar' | 'desconectar' | 'historico'
  clinicName: string
  /** Papel na clínica ativa; o botão de staging dev-sync só aparece ao dono. */
  isOwner?: boolean
}

async function runEmbeddedSignup(
  api: PanelApi,
  tenantId: string,
  purpose: WhatsappSignupPurpose,
  generation: number,
  fixture?: {
    phoneNumberId: string
    wabaId: string
    displayPhone: string
    displayName?: string
  },
): Promise<WhatsappConnection> {
  const session = await api.startWhatsappSession(tenantId, purpose, {
    generation,
    expectGeneration: () => generation,
  })

  if (session.metaMode === 'live') {
    // Live: o cliente deve carregar FB SDK + config_id; até App Review usamos synthetic.
    throw new PanelApiError(
      501,
      'unknown',
      'A conexão com o WhatsApp ainda não está liberada para esta clínica. Fale com o suporte do Tredane.',
    )
  }

  // Synthetic: diálogo de fixture (substitui popup Meta em dev/teste).
  const phoneNumberId =
    fixture?.phoneNumberId
    ?? `pnid_synth_${tenantId.replace(/[^a-z0-9]/gi, '').slice(-8)}_${Date.now().toString(36)}`
  const wabaId = fixture?.wabaId ?? `waba_synth_${phoneNumberId}`
  const displayPhone =
    fixture?.displayPhone ?? `+5511${String(Date.now()).slice(-8)}`

  return api.completeWhatsappSignup(
    tenantId,
    {
      state: session.state,
      code: 'synth_code_valid',
      phoneNumberId,
      wabaId,
      displayPhone,
      displayName: fixture?.displayName ?? 'WhatsApp da clínica (teste)',
    },
    { generation, expectGeneration: () => generation },
  )
}

export function WhatsappScreen({
  tenantId,
  api,
  generation,
  mode,
  clinicName,
  isOwner = false,
}: Props) {
  const { conn, error, detail, loading, reload, setConn } = useWhatsapp(
    api,
    tenantId,
    generation,
  )
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmName, setConfirmName] = useState('')
  const [replaceAck, setReplaceAck] = useState(false)
  const [viewerId, setViewerId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void api
      .getMe({ generation, expectGeneration: () => generation })
      .then((me) => {
        if (!cancelled) setViewerId(me.clerkUserId)
      })
      .catch(() => {
        if (!cancelled) setViewerId(null)
      })
    return () => {
      cancelled = true
    }
  }, [api, generation])

  // STAGING-ONLY (dono): mesma ação da tela /clinica/whatsapp/dev-sync.
  const devSync =
    isOwner && isStagingHostname() ? (
      <section aria-labelledby="wa-devsync" className="whatsapp-dev-sync-section">
        <h3 id="wa-devsync" className="whatsapp-subhead">
          Staging: WhatsApp de teste
        </h3>
        <WhatsappDevSyncAction
          tenantId={tenantId}
          api={api}
          generation={generation}
          hideWhenNotFound
          className="panel-btn-secondary"
          onSuccess={() => void reload()}
        />
      </section>
    ) : null

  if (loading && !conn) {
    return <LoadingState label="Carregando conexão WhatsApp…" />
  }
  if (error && !conn) {
    return (
      <ErrorState
        title="Não foi possível carregar o WhatsApp"
        description={error}
        detail={detail}
        actionLabel="Tentar de novo"
        onAction={() => void reload()}
      />
    )
  }
  if (!conn) return <LoadingState label="Carregando conexão WhatsApp…" />

  async function onConnect(purpose: WhatsappSignupPurpose) {
    setBusy(true)
    setActionError(null)
    try {
      const next = await runEmbeddedSignup(api, tenantId, purpose, generation)
      setConn(next)
      navigatePanel({
        kind: 'area',
        area: 'clinica',
        tenantId,
        section: 'whatsapp',
      })
    } catch (err) {
      setActionError(
        friendlyError(err, 'Não foi possível conectar o WhatsApp. Tente de novo.'),
      )
    } finally {
      setBusy(false)
    }
  }

  async function onDisconnect() {
    setBusy(true)
    setActionError(null)
    try {
      const next = await api.disconnectWhatsapp(tenantId, confirmName, {
        generation,
        expectGeneration: () => generation,
      })
      setConn(next)
      navigatePanel({
        kind: 'area',
        area: 'clinica',
        tenantId,
        section: 'whatsapp',
      })
    } catch (err) {
      setActionError(
        friendlyError(err, 'Não foi possível desconectar o WhatsApp. Tente de novo.'),
      )
    } finally {
      setBusy(false)
    }
  }

  async function onSimulateInterrupt() {
    setBusy(true)
    setActionError(null)
    try {
      const next = await api.interruptWhatsappDev(
        tenantId,
        'Autorização removida ou expirada (simulado)',
        { generation, expectGeneration: () => generation },
      )
      setConn(next)
    } catch (err) {
      setActionError(friendlyError(err, 'Não deu para concluir agora. Tente de novo.'))
    } finally {
      setBusy(false)
    }
  }

  function goTo(section: 'whatsapp' | 'whatsapp-trocar' | 'whatsapp-historico' | 'whatsapp-desconectar') {
    navigatePanel({ kind: 'area', area: 'clinica', tenantId, section })
  }

  if (mode === 'historico') {
    return (
      <div className="clinic-stack whatsapp-stack">
        <header className="clinic-toolbar">
          <Button className="panel-btn-ghost" onPress={() => goTo('whatsapp')}>
            <ChevronLeft aria-hidden size={20} strokeWidth={2} />
            WhatsApp
          </Button>
        </header>
        <h2 className="whatsapp-subhead">Histórico da conexão</h2>
        <HistoryList items={conn.history} limit={50} />
      </div>
    )
  }

  if (mode === 'desconectar') {
    return (
      <div className="clinic-stack whatsapp-stack">
        <header className="clinic-toolbar">
          <Button
            className="panel-btn-ghost"
            onPress={() =>
              navigatePanel({
                kind: 'area',
                area: 'clinica',
                tenantId,
                section: 'whatsapp',
              })
            }
          >
            <ChevronLeft aria-hidden size={20} strokeWidth={2} />
            Voltar
          </Button>
        </header>
        <Banner tone="warn" title="Desconectar WhatsApp">
          <p>
            A clínica deixa de receber e enviar mensagens. Conversas, contatos e
            agenda continuam salvos. Para voltar a atender, é preciso conectar de novo.
          </p>
        </Banner>
        <TextField className="clinic-field">
          <Label>Digite o nome da clínica para confirmar</Label>
          <Input
            autoComplete="off"
            autoCapitalize="words"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            aria-label="Nome da clínica"
          />
        </TextField>
        {actionError ? (
          <p className="clinic-footnote clinic-footnote-warn" role="alert">
            {actionError}
          </p>
        ) : null}
        <div className="clinic-actions">
          <Button
            className="panel-btn-primary"
            isDisabled={busy || confirmName.trim() !== clinicName.trim()}
            onPress={() => void onDisconnect()}
          >
            Desconectar
          </Button>
          <Button
            className="panel-btn-ghost"
            onPress={() =>
              navigatePanel({
                kind: 'area',
                area: 'clinica',
                tenantId,
                section: 'whatsapp',
              })
            }
          >
            Cancelar
          </Button>
        </div>
      </div>
    )
  }

  if (mode === 'trocar') {
    return (
      <div className="clinic-stack whatsapp-stack">
        <header className="clinic-toolbar">
          <Button
            className="panel-btn-ghost"
            onPress={() =>
              navigatePanel({
                kind: 'area',
                area: 'clinica',
                tenantId,
                section: 'whatsapp',
              })
            }
          >
            <ChevronLeft aria-hidden size={20} strokeWidth={2} />
            Voltar
          </Button>
        </header>
        <Banner tone="info" title="Trocar número">
          <ul className="whatsapp-bullets">
            <li>Conversas, contatos e agenda ficam nesta clínica.</li>
            <li>O número atual para de receber mensagens no Tredane.</li>
            <li>As clientes precisam escrever para o número novo.</li>
            <li>Os modelos de mensagem precisam ser aprovados de novo.</li>
          </ul>
        </Banner>
        <label className="clinic-check">
          <input
            type="checkbox"
            checked={replaceAck}
            onChange={(e) => setReplaceAck(e.target.checked)}
          />
          <span>Entendi o que muda ao trocar o número</span>
        </label>
        {actionError ? (
          <p className="clinic-footnote clinic-footnote-warn" role="alert">
            {actionError}
          </p>
        ) : null}
        <Button
          className="panel-btn-primary"
          isDisabled={busy || !replaceAck}
          onPress={() => void onConnect('replace')}
        >
          Continuar no Facebook
        </Button>
      </div>
    )
  }

  // main: disconnected / connected / interrupted
  if (conn.status === 'disconnected') {
    return (
      <div className="clinic-stack whatsapp-stack">
        <header className="clinic-toolbar">
          <Button
            className="panel-btn-ghost"
            onPress={() =>
              navigatePanel({
                kind: 'area',
                area: 'clinica',
                tenantId,
                section: 'hub',
              })
            }
          >
            <ChevronLeft aria-hidden size={20} strokeWidth={2} />
            Clínica
          </Button>
        </header>
        <Banner tone="info" title="Conectar WhatsApp">
          <p>
            Conecte o WhatsApp da clínica. Você vai entrar com a conta do Facebook
            que administra a clínica e escolher o número. O Tredane não vê a sua
            senha.
          </p>
          <ol className="whatsapp-steps">
            <li>Entre com o Facebook da clínica.</li>
            <li>Escolha o número de WhatsApp.</li>
            <li>Confirme. As mensagens começam a chegar aqui.</li>
          </ol>
        </Banner>
        {conn.metaMode === 'synthetic' ? (
          <TestOnly note="Esta conexão é simulada e não usa um número real." />
        ) : null}
        {actionError ? (
          <p className="clinic-footnote clinic-footnote-warn" role="alert">
            {actionError}
          </p>
        ) : null}
        <Button
          className="panel-btn-primary"
          isDisabled={busy}
          onPress={() => void onConnect('connect')}
        >
          Conectar WhatsApp
        </Button>
        {devSync}
      </div>
    )
  }

  if (conn.status === 'interrupted') {
    return (
      <div className="clinic-stack whatsapp-stack">
        <header className="clinic-toolbar">
          <Button
            className="panel-btn-ghost"
            onPress={() =>
              navigatePanel({
                kind: 'area',
                area: 'clinica',
                tenantId,
                section: 'hub',
              })
            }
          >
            <ChevronLeft aria-hidden size={20} strokeWidth={2} />
            Clínica
          </Button>
        </header>
        <Banner tone="error" title="O WhatsApp parou de funcionar">
          <p>
            {conn.interruptedAt
              ? `Desde ${formatWhen(conn.interruptedAt)}, as mensagens não estão chegando nem saindo.`
              : 'As mensagens não estão chegando nem saindo.'}
            {friendlyReason(conn.interruptReason)
              ? ` ${friendlyReason(conn.interruptReason)}`
              : ''}
          </p>
          <p>
            Enquanto estiver desconectado, as respostas ficam como “Não enviada”. O
            histórico continua salvo. Ao reconectar, nada é reenviado sozinho.
          </p>
          {conn.interruptReason ? (
            <details className="clinic-details">
              <summary>Detalhes para o suporte</summary>
              <code>{conn.interruptReason}</code>
            </details>
          ) : null}
        </Banner>
        {actionError ? (
          <p className="clinic-footnote clinic-footnote-warn" role="alert">
            {actionError}
          </p>
        ) : null}
        <Button
          className="panel-btn-primary"
          isDisabled={busy}
          onPress={() => void onConnect('reconnect')}
        >
          Reconectar WhatsApp
        </Button>
        {devSync}
        <ul className="clinic-nav-list">
          <li>
            <NavRow
              icon={History}
              title="Histórico da conexão"
              detail={historyCount(conn.history.length)}
              onPress={() => goTo('whatsapp-historico')}
            />
          </li>
        </ul>
      </div>
    )
  }

  // connected
  return (
    <div className="clinic-stack whatsapp-stack">
      <header className="clinic-toolbar">
        <Button
          className="panel-btn-ghost"
          onPress={() =>
            navigatePanel({
              kind: 'area',
              area: 'clinica',
              tenantId,
              section: 'hub',
            })
          }
        >
          <ChevronLeft aria-hidden size={20} strokeWidth={2} />
          Clínica
        </Button>
      </header>
      <Banner tone="ok" title="WhatsApp conectado">
        <p>
          <strong>{formatPhone(conn.displayPhone)}</strong>
          {conn.displayName ? ` · ${conn.displayName}` : ''}
        </p>
        <p className="clinic-footnote">
          Conectado {connectedByLabel(conn.connectedByClerkUserId, viewerId)} em{' '}
          {formatWhen(conn.connectedAt)}. Última mensagem recebida:{' '}
          {conn.lastInboundAt ? formatWhen(conn.lastInboundAt) : 'nenhuma ainda'}.
        </p>
      </Banner>

      <section aria-labelledby="wa-tpl">
        <h3 id="wa-tpl" className="whatsapp-subhead">
          Modelos de mensagem
        </h3>
        {conn.messageTemplates.length === 0 ? (
          <p className="clinic-footnote">
            Nenhum modelo aprovado ainda. Modelos servem para falar com a cliente depois de 24 horas sem resposta. A Meta aprova cada um e isso pode levar alguns dias.
          </p>
        ) : (
          <ul className="whatsapp-tpl-list clinic-nav-list">
            {conn.messageTemplates.map((t) => {
              const st = templateStatus(t.status)
              return (
                <li key={t.name} className="whatsapp-tpl">
                  <span className="clinic-nav-copy">
                    <strong>{templateTitle(t.name)}</strong>
                    <span>{t.name}</span>
                  </span>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <ul className="clinic-nav-list">
        <li>
          <NavRow
            icon={Repeat}
            title="Trocar número"
            detail="Usar outro número na clínica"
            onPress={() => goTo('whatsapp-trocar')}
          />
        </li>
        <li>
          <NavRow
            icon={History}
            title="Histórico da conexão"
            detail={historyCount(conn.history.length)}
            onPress={() => goTo('whatsapp-historico')}
          />
        </li>
        <li>
          <NavRow
            icon={Unplug}
            title="Desconectar WhatsApp"
            detail="Para de receber e enviar mensagens"
            state="danger"
            onPress={() => goTo('whatsapp-desconectar')}
          />
        </li>
      </ul>

      {conn.metaMode === 'synthetic' ? (
        <TestOnly note="Simula a queda do WhatsApp para ver como a tela fica.">
          <Button
            className="panel-btn-secondary"
            isDisabled={busy}
            onPress={() => void onSimulateInterrupt()}
          >
            Simular queda do WhatsApp
          </Button>
        </TestOnly>
      ) : null}

      {actionError ? (
        <p className="clinic-footnote clinic-footnote-warn" role="alert">
          {actionError}
        </p>
      ) : null}

      {devSync}
    </div>
  )
}

function historyCount(n: number): string {
  if (n === 0) return 'Nenhum registro ainda'
  return n === 1 ? '1 registro' : `${n} registros`
}

function HistoryList({
  items,
  limit = 8,
}: {
  items: WhatsappConnection['history']
  limit?: number
}) {
  if (items.length === 0) {
    return <p className="clinic-footnote">Ainda não há registros nesta conexão.</p>
  }
  return (
    <ul className="whatsapp-history">
      {items.slice(0, limit).map((h) => (
        <li key={h.id}>
          <strong>{historyLabel(h.action)}</strong>
          <span>{formatWhen(h.occurredAt)}</span>
        </li>
      ))}
    </ul>
  )
}

/** Banner global M-24 — visível a todos os membros. */
export function WhatsappInterruptBanner({
  tenantId,
  conn,
  isOwner,
}: {
  tenantId: string
  conn: WhatsappConnection | null
  isOwner: boolean
}) {
  const { active } = useTenant()
  if (!conn || conn.status !== 'interrupted') return null
  if (active.phase !== 'ready' || active.context.tenantId !== tenantId) return null

  return (
    <div className="whatsapp-global-banner" role="alert">
      <div>
        <strong>WhatsApp desconectado</strong>
        <span>
          {friendlyReason(conn.interruptReason) ?? 'As mensagens não estão chegando nem saindo.'}
          {conn.interruptedAt ? ` · desde ${formatWhen(conn.interruptedAt)}` : ''}
        </span>
      </div>
      {isOwner ? (
        <Button
          className="panel-btn-secondary panel-btn-compact"
          onPress={() =>
            navigatePanel({
              kind: 'area',
              area: 'clinica',
              tenantId,
              section: 'whatsapp',
            })
          }
        >
          Reconectar
        </Button>
      ) : (
        <span className="clinic-footnote">Avise o responsável pela clínica</span>
      )}
    </div>
  )
}
