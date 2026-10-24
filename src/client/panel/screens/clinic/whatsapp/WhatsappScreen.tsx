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

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
  mode: 'main' | 'trocar' | 'desconectar'
  clinicName: string
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
      'Embedded Signup live requer META_APP_ID/CONFIG no dashboard Meta (gate #18)',
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

  if (loading && !conn) {
    return <LoadingState label="A carregar conexão WhatsApp…" />
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
  if (!conn) return <LoadingState label="A carregar conexão WhatsApp…" />

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
            A clínica deixa de receber e enviar mensagens. Conversas, contactos e
            agenda são mantidos. É preciso conectar de novo para voltar a atender.
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
            <li>Conversas, contactos e agenda ficam nesta clínica.</li>
            <li>O número actual deixa de rotear mensagens para o Tredane.</li>
            <li>Contactos precisam escrever ao número novo.</li>
            <li>Modelos precisam de nova aprovação na Meta.</li>
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
          Continuar para a Meta
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
            O responsável liga a conta e o número da clínica pelo Embedded Signup
            oficial da Meta. O Tredane actua como Tech Provider (DEC-009). Tokens
            nunca aparecem neste ecrã.
          </p>
          <ol className="whatsapp-steps">
            <li>Abrir a janela da Meta com a conta Business da clínica.</li>
            <li>Escolher ou criar o número oficial.</li>
            <li>Confirmar a associação — o backend valida estado e unicidade.</li>
          </ol>
        </section>
        {conn.metaMode === 'synthetic' ? (
          <p className="clinic-footnote" role="status">
            Ambiente de teste: o fluxo usa fixtures Meta (sem WABA de produção).
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
          <h2 id="wa-int">Conexão interrompida</h2>
          <p>
            {conn.interruptReason ?? 'A Meta deixou de aceitar o acesso.'}
            {conn.interruptedAt
              ? ` · desde ${formatWhen(conn.interruptedAt)}`
              : ''}
          </p>
          <p>
            Enquanto estiver desconectado, envios aparecem como «Não enviada». O
            histórico é mantido. Ao reconectar, nada é reenviado automaticamente.
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
          Ligado por {conn.connectedByClerkUserId ?? '—'} em{' '}
          {formatWhen(conn.connectedAt)}. Última mensagem recebida:{' '}
          {formatWhen(conn.lastInboundAt)}.
        </p>
      </section>

      <section aria-labelledby="wa-tpl">
        <h3 id="wa-tpl" className="whatsapp-subhead">
          Modelos de mensagem
        </h3>
        {conn.messageTemplates.length === 0 ? (
          <p className="clinic-footnote">
            Nenhum modelo listado ainda — aprovação Meta é gate do piloto (#18 /
            GATE-10).
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
          Simular interrupção (teste)
        </Button>
      ) : null}

      {actionError ? (
        <p className="clinic-footnote clinic-footnote-warn" role="alert">
          {actionError}
        </p>
      ) : null}

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
        <strong>WhatsApp interrompido</strong>
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
        <span className="clinic-footnote">Peça ao responsável para reconectar</span>
      )}
    </div>
  )
}
