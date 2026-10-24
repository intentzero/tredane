/**
 * M-33 — Recebimento de sinais (conta Woovi + prazo + política).
 * Só owner (área Clínica). Cobrança na conversa = Agendar / #38.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Input, Label, TextArea, TextField } from 'react-aria-components'
import type { PanelApi, PixSnapshot } from '../../../api'
import { PanelApiError } from '../../../api'
import { navigatePanel } from '../../../routes'
import { ErrorState, LoadingState } from '../../../states/StatusScreens'

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
}

function statusLabel(status: string): string {
  switch (status) {
    case 'connected':
      return 'Conta conectada'
    case 'revoked':
      return 'Credencial revogada'
    default:
      return 'Sem conta conectada'
  }
}

export function RecebimentoScreen({ tenantId, api, generation }: Props) {
  const [snap, setSnap] = useState<PixSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [appId, setAppId] = useState('')
  const [deadlineHours, setDeadlineHours] = useState('2')
  const [policy, setPolicy] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionOk, setActionOk] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await api.getPix(tenantId, {
        generation,
        expectGeneration: () => generation,
      })
      setSnap(next)
      setDeadlineHours(String(next.signalSettings.deadlineSeconds / 3600))
      setPolicy(next.signalSettings.cancellationPolicy)
    } catch (err) {
      if (err instanceof PanelApiError && err.message === 'stale_tenant_response') return
      setError(err instanceof Error ? err.message : 'erro')
    } finally {
      setLoading(false)
    }
  }, [api, tenantId, generation])

  useEffect(() => {
    void reload()
  }, [reload])

  if (loading && !snap) {
    return <LoadingState label="A carregar recebimento de sinais…" />
  }
  if (error && !snap) {
    return (
      <ErrorState
        title="Não foi possível carregar o Pix"
        description={error}
        actionLabel="Tentar de novo"
        onAction={() => void reload()}
      />
    )
  }
  if (!snap) return <LoadingState label="A carregar recebimento de sinais…" />

  const connected = snap.account.status === 'connected'

  async function onConnect() {
    setBusy(true)
    setActionError(null)
    setActionOk(null)
    try {
      const account = await api.connectPix(tenantId, appId.trim(), {
        generation,
        expectGeneration: () => generation,
      })
      setSnap((prev) =>
        prev ? { ...prev, account } : { account, signalSettings: snap!.signalSettings },
      )
      setAppId('')
      setActionOk('Conta Woovi conectada. O dinheiro vai directo para a clínica.')
    } catch (err) {
      setActionError(
        err instanceof PanelApiError
          ? err.message
          : 'Não foi possível conectar a conta.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function onDisconnect() {
    setBusy(true)
    setActionError(null)
    setActionOk(null)
    try {
      const result = await api.disconnectPix(tenantId, {
        generation,
        expectGeneration: () => generation,
      })
      setSnap((prev) =>
        prev
          ? { ...prev, account: result.account }
          : { account: result.account, signalSettings: snap!.signalSettings },
      )
      setActionOk(
        `Conta desconectada. ${result.chargesPreserved} cobrança(s) preservada(s) no histórico.`,
      )
    } catch (err) {
      setActionError(
        err instanceof PanelApiError
          ? err.message
          : 'Não foi possível desconectar.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function onSaveSettings() {
    setBusy(true)
    setActionError(null)
    setActionOk(null)
    const hours = Number(deadlineHours)
    const deadlineSeconds = Math.round(hours * 3600)
    try {
      const signalSettings = await api.updatePixSignalSettings(
        tenantId,
        {
          deadlineSeconds,
          cancellationPolicy: policy,
        },
        { generation, expectGeneration: () => generation },
      )
      setSnap((prev) =>
        prev
          ? { ...prev, signalSettings }
          : { account: snap!.account, signalSettings },
      )
      setActionOk('Prazo e política de cancelamento salvos.')
    } catch (err) {
      setActionError(
        err instanceof PanelApiError
          ? err.message
          : 'Não foi possível salvar as definições.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="clinic-stack">
      <div className="clinic-toolbar">
        <Button
          className="panel-btn panel-btn-ghost"
          onPress={() =>
            navigatePanel({ kind: 'area', area: 'clinica', tenantId, section: 'hub' })
          }
        >
          Voltar
        </Button>
      </div>

      <section className="clinic-banner" aria-labelledby="pix-account-title">
        <h2 id="pix-account-title">Recebimento de sinais</h2>
        <p>
          Provedor: Woovi (OpenPix). O Tredane cria a cobrança na conta da clínica e{' '}
          <strong>não</strong> recebe nem repassa dinheiro (DEC-047/049).
        </p>
      </section>

      <section className="clinic-stack" aria-labelledby="pix-status">
        <h3 id="pix-status">{statusLabel(snap.account.status)}</h3>
        {connected ? (
          <>
            <p className="clinic-footnote">
              Conta {snap.account.appIdHint} · versão da credencial{' '}
              {snap.account.credentialVersion} · ambiente {snap.account.environment}
            </p>
            <Button
              className="panel-btn panel-btn-ghost"
              isDisabled={busy}
              onPress={() => void onDisconnect()}
            >
              Desconectar conta
            </Button>
          </>
        ) : (
          <>
            <p className="clinic-footnote clinic-footnote-warn" role="status">
              Sem conta conectada, serviços com sinal não permitem enviar cobrança. A
              atendente ainda pode confirmar sem sinal (com motivo).
            </p>
            <TextField className="clinic-field">
              <Label>App ID Woovi da clínica</Label>
              <Input
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                autoComplete="off"
                placeholder="Cole o App ID (nunca partilhe no front em produção)"
              />
            </TextField>
            <p className="clinic-footnote">
              Em desenvolvimento use um App ID sintético (validado localmente). Chaves
              reais e DPA ficam no GATE-08.
            </p>
            <Button
              className="panel-btn panel-btn-primary"
              isDisabled={busy || appId.trim().length < 8}
              onPress={() => void onConnect()}
            >
              Conectar conta
            </Button>
          </>
        )}
      </section>

      <section className="clinic-stack" aria-labelledby="pix-policy">
        <h3 id="pix-policy">Prazo e política de cancelamento</h3>
        <TextField className="clinic-field">
          <Label>Prazo para pagar (horas)</Label>
          <Input
            value={deadlineHours}
            onChange={(e) => setDeadlineHours(e.target.value)}
            inputMode="decimal"
          />
        </TextField>
        <p className="clinic-footnote">Padrão: 2 horas (DEC-047). Mínimo 0,25 h · máximo 48 h.</p>
        <TextField className="clinic-field">
          <Label>Política de cancelamento do sinal</Label>
          <TextArea
            value={policy}
            onChange={(e) => setPolicy(e.target.value)}
            rows={4}
            placeholder="Texto mostrado à cliente antes de pagar…"
          />
        </TextField>
        <Button
          className="panel-btn panel-btn-primary"
          isDisabled={busy}
          onPress={() => void onSaveSettings()}
        >
          Salvar prazo e política
        </Button>
      </section>

      {actionError ? (
        <p className="clinic-form-error" role="alert">
          {actionError}
        </p>
      ) : null}
      {actionOk ? (
        <p className="clinic-footnote" role="status">
          {actionOk}
        </p>
      ) : null}
    </div>
  )
}
