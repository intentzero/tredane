/**
 * TEL-09 WhatsApp — M-19 / M-23 / M-24 / M-25 / M-26 (#31 / DEC-009 / REQ-051).
 * Embedded Signup: modo synthetic (fixtures) até gates Meta (#18).
 */
import { useState } from 'react'
import { Button, Input, Label, TextField } from 'react-aria-components'
import type { PanelApi, WhatsappConnection, WhatsappSignupPurpose } from '../../../api'
import { PanelApiError } from '../../../api'
import { navigatePanel } from '../../../routes'
import { ErrorState, LoadingState } from '../../../states/StatusScreens'
import { useTenant } from '../../../tenant/TenantContext'
import { formatPhone, formatWhen, historyLabel } from './format'
import { useWhatsapp } from './useWhatsapp'
import { isStagingHostname, WhatsappDevSyncAction } from './WhatsappDevSyncAction'

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
  mode: 'main' | 'trocar' | 'desconectar'
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
  const { conn, error, loading, reload, setConn } = useWhatsapp(
    api,
    tenantId,
    generation,
  )
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmName, setConfirmName] = useState('')
  const [replaceAck, setReplaceAck] = useState(false)

  // STAGING-ONLY (dono): mesma acção do tela /clinica/whatsapp/dev-sync.
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
        err instanceof PanelApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Falha ao conectar',
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
        err instanceof PanelApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Falha ao desconectar',
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
      setActionError(err instanceof Error ? err.message : 'Falha')
    } finally {
      setBusy(false)
    }
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
            Voltar
          </Button>
        </header>
        <section className="clinic-banner" aria-labelledby="wa-disc-title">
          <h2 id="wa-disc-title">Desconectar WhatsApp</h2>
          <p>
            A clínica deixa de receber e enviar mensagens. Conversas, contatos e
            agenda continuam salvos. Para voltar a atender, é preciso conectar de novo.
          </p>
        </section>
        <TextField className="clinic-field">
          <Label>Digite o nome da clínica para confirmar</Label>
          <Input
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
            Voltar
          </Button>
        </header>
        <section className="clinic-banner" aria-labelledby="wa-swap-title">
          <h2 id="wa-swap-title">Trocar número</h2>
          <ul className="whatsapp-bullets">
            <li>Conversas, contatos e agenda ficam nesta clínica.</li>
            <li>O número atual para de receber mensagens no Tredane.</li>
            <li>As clientes precisam escrever para o número novo.</li>
            <li>Os modelos de mensagem precisam ser aprovados de novo.</li>
          </ul>
        </section>
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
            Clínica
          </Button>
        </header>
        <section className="clinic-banner" aria-labelledby="wa-disc">
          <h2 id="wa-disc">Conectar WhatsApp</h2>
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
        </section>
        {conn.metaMode === 'synthetic' ? (
          <p className="clinic-footnote" role="status">
            Ambiente de testes: esta conexão é simulada e não usa um número real.
          </p>
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
            Clínica
          </Button>
        </header>
        <section
          className="clinic-banner clinic-banner-warn"
          aria-labelledby="wa-int"
          role="alert"
        >
          <h2 id="wa-int">O WhatsApp parou de funcionar</h2>
          <p>
            {conn.interruptReason ?? 'A Meta deixou de aceitar o acesso.'}
            {conn.interruptedAt
              ? ` · desde ${formatWhen(conn.interruptedAt)}`
              : ''}
          </p>
          <p>
            Enquanto estiver desconectado, as respostas ficam como “Não enviada”. O
            histórico continua salvo. Ao reconectar, nada é reenviado sozinho.
          </p>
        </section>
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
        <HistoryList items={conn.history} />
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
          Clínica
        </Button>
      </header>
      <section className="clinic-banner clinic-banner-ok" aria-labelledby="wa-ok">
        <h2 id="wa-ok">WhatsApp conectado</h2>
        <p>
          <strong>{formatPhone(conn.displayPhone)}</strong>
          {conn.displayName ? ` · ${conn.displayName}` : ''}
        </p>
        <p className="clinic-footnote">
          Conectado em {formatWhen(conn.connectedAt)}. Última mensagem recebida:{' '}
          {conn.lastInboundAt ? formatWhen(conn.lastInboundAt) : 'nenhuma ainda'}.
        </p>
      </section>

      <section aria-labelledby="wa-tpl">
        <h3 id="wa-tpl" className="whatsapp-subhead">
          Modelos de mensagem
        </h3>
        {conn.messageTemplates.length === 0 ? (
          <p className="clinic-footnote">
            Nenhum modelo aprovado ainda. Modelos servem para falar com a cliente depois de 24 horas sem resposta. A Meta aprova cada um e isso pode levar alguns dias.
          </p>
        ) : (
          <ul className="whatsapp-tpl-list">
            {conn.messageTemplates.map((t) => (
              <li key={t.name}>
                {t.name} · {t.status}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="clinic-actions">
        <Button
          className="panel-btn-secondary"
          onPress={() =>
            navigatePanel({
              kind: 'area',
              area: 'clinica',
              tenantId,
              section: 'whatsapp-trocar',
            })
          }
        >
          Trocar número
        </Button>
        <Button
          className="panel-btn-ghost"
          onPress={() =>
            navigatePanel({
              kind: 'area',
              area: 'clinica',
              tenantId,
              section: 'whatsapp-desconectar',
            })
          }
        >
          Desconectar
        </Button>
      </div>

      {conn.metaMode === 'synthetic' ? (
        <Button
          className="panel-btn-ghost"
          isDisabled={busy}
          onPress={() => void onSimulateInterrupt()}
        >
          [Teste] Simular queda do WhatsApp
        </Button>
      ) : null}

      {actionError ? (
        <p className="clinic-footnote clinic-footnote-warn" role="alert">
          {actionError}
        </p>
      ) : null}

      {devSync}

      <HistoryList items={conn.history} />
    </div>
  )
}

function HistoryList({
  items,
}: {
  items: WhatsappConnection['history']
}) {
  if (items.length === 0) return null
  return (
    <section aria-labelledby="wa-hist">
      <h3 id="wa-hist" className="whatsapp-subhead">
        Histórico
      </h3>
      <ul className="whatsapp-history">
        {items.slice(0, 8).map((h) => (
          <li key={h.id}>
            <strong>{historyLabel(h.action)}</strong>
            <span>
              {formatWhen(h.occurredAt)}
              {h.phoneNumberId ? ` · ${h.phoneNumberId}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
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
          {conn.interruptReason ?? 'Sem acesso à Meta'}
          {conn.interruptedAt ? ` · ${formatWhen(conn.interruptedAt)}` : ''}
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
