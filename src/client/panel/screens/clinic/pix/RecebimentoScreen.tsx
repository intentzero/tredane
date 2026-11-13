/**
 * M-33 — Recebimento de sinais (conta Woovi + prazo + política).
 * Só owner (área Clínica). Cobrança na conversa = Agendar / #38.
 * DEC-174: estado em faixa, um cartão por decisão, resposta junto do botão.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Input, Label, TextArea, TextField } from 'react-aria-components'
import type { PanelApi, PixSnapshot } from '../../../api'
import { PanelApiError } from '../../../api'
import { ErrorState } from '../../../states/StatusScreens'
import { friendlyError } from '../../../copy/errors'
import { Banner } from '../../../states/Banner'
import { ClinicSkeleton } from '../ClinicSkeleton'
import { BusyLabel, CardNotice, type CardNoticeValue } from '../CardFooter'

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
}

type Busy = null | 'connect' | 'disconnect' | 'save'
type Notice = CardNoticeValue & { card: 'account' | 'policy' }

export function RecebimentoScreen({ tenantId, api, generation }: Props) {
  const [snap, setSnap] = useState<PixSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [appId, setAppId] = useState('')
  const [deadlineHours, setDeadlineHours] = useState('2')
  const [policy, setPolicy] = useState('')
  const [busy, setBusy] = useState<Busy>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  const reload = useCallback(async () => {
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
      setError(friendlyError(err, 'Não conseguimos carregar. Tente de novo.'))
    }
  }, [api, tenantId, generation])

  useEffect(() => {
    void reload()
  }, [reload])

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
  if (!snap) {
    return <ClinicSkeleton shape="form" label="Carregando Recebimento de sinais" />
  }

  const connected = snap.account.status === 'connected'
  const revoked = snap.account.status === 'revoked'

  async function onConnect() {
    if (appId.trim().length < 8) {
      setNotice({ card: 'account', tone: 'error', text: 'Cole o App ID completo da Woovi.' })
      return
    }
    setBusy('connect')
    setNotice(null)
    try {
      const account = await api.connectPix(tenantId, appId.trim(), {
        generation,
        expectGeneration: () => generation,
      })
      setSnap((prev) =>
        prev ? { ...prev, account } : { account, signalSettings: snap!.signalSettings },
      )
      setAppId('')
      setNotice({
        card: 'account',
        tone: 'ok',
        text: 'Conta Woovi conectada. O dinheiro vai direto para a clínica.',
      })
    } catch (err) {
      setNotice({
        card: 'account',
        tone: 'error',
        text: friendlyError(err, 'Não foi possível conectar a conta.'),
      })
    } finally {
      setBusy(null)
    }
  }

  async function onDisconnect() {
    setBusy('disconnect')
    setNotice(null)
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
      setNotice({
        card: 'account',
        tone: 'ok',
        text: `Conta desconectada. ${result.chargesPreserved} cobrança(s) preservada(s) no histórico.`,
      })
    } catch (err) {
      setNotice({
        card: 'account',
        tone: 'error',
        text: friendlyError(err, 'Não foi possível desconectar.'),
      })
    } finally {
      setBusy(null)
    }
  }

  async function onSaveSettings() {
    setBusy('save')
    setNotice(null)
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
        prev ? { ...prev, signalSettings } : { account: snap!.account, signalSettings },
      )
      setNotice({ card: 'policy', tone: 'ok', text: 'Prazo e política salvos.' })
    } catch (err) {
      setNotice({
        card: 'policy',
        tone: 'error',
        text: friendlyError(err, 'Não foi possível salvar as definições.'),
      })
    } finally {
      setBusy(null)
    }
  }

  const accountNotice = notice?.card === 'account' ? notice : null
  const policyNotice = notice?.card === 'policy' ? notice : null

  return (
    <div className="clinic-stack">
      {connected ? (
        <Banner tone="ok" title="Conta conectada">
          <p>
            Conta {snap.account.appIdHint} · versão da credencial {snap.account.credentialVersion} ·
            ambiente {snap.account.environment}
          </p>
        </Banner>
      ) : (
        <Banner tone="warn" title={revoked ? 'Credencial revogada' : 'Sem conta conectada'}>
          <p>
            Serviços com sinal não conseguem enviar cobrança. A atendente ainda pode confirmar sem
            sinal, com motivo.
          </p>
        </Banner>
      )}

      <section className="panel-card clinic-card" aria-labelledby="pix-account">
        <h2 id="pix-account" className="panel-title-md">
          Conta Woovi
        </h2>
        {connected ? (
          <p className="clinic-footnote">
            Para trocar de conta, desconecte esta e conecte a nova. As cobranças já feitas ficam no
            histórico.
          </p>
        ) : (
          <TextField className="clinic-field">
            <Label>App ID da clínica</Label>
            <Input
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              autoComplete="off"
              placeholder="Cole aqui"
            />
            <span className="clinic-footnote">
              Não compartilhe com ninguém. Em testes, use um App ID de exemplo; o real só depois de o
              suporte do Tredane liberar a conta.
            </span>
          </TextField>
        )}
        <div className="clinic-card-footer">
          <CardNotice notice={accountNotice} />
          {connected ? (
            <Button
              className="panel-btn-danger"
              isDisabled={busy !== null}
              onPress={() => void onDisconnect()}
            >
              <BusyLabel busy={busy === 'disconnect'} busyText="Desconectando…">
                Desconectar conta
              </BusyLabel>
            </Button>
          ) : (
            <Button
              className="panel-btn-primary"
              isDisabled={busy !== null}
              onPress={() => void onConnect()}
            >
              <BusyLabel busy={busy === 'connect'} busyText="Conectando…">
                Conectar conta
              </BusyLabel>
            </Button>
          )}
        </div>
      </section>

      <section className="panel-card clinic-card" aria-labelledby="pix-policy">
        <h2 id="pix-policy" className="panel-title-md">
          Prazo e política de cancelamento
        </h2>
        <TextField className="clinic-field">
          <Label>Prazo para pagar (horas)</Label>
          <Input
            value={deadlineHours}
            onChange={(e) => setDeadlineHours(e.target.value)}
            inputMode="decimal"
          />
          <span className="clinic-footnote">
            Padrão: 2 horas. Mínimo de 15 minutos e máximo de 48 horas.
          </span>
        </TextField>
        <TextField className="clinic-field">
          <Label>Política de cancelamento do sinal</Label>
          <TextArea
            value={policy}
            onChange={(e) => setPolicy(e.target.value)}
            rows={4}
            placeholder="Ex.: o sinal é devolvido se a cliente cancelar com 24 horas de antecedência."
          />
          <span className="clinic-footnote">A cliente vê este texto antes de pagar.</span>
        </TextField>
        <div className="clinic-card-footer">
          <CardNotice notice={policyNotice} />
          <Button
            className="panel-btn-primary"
            isDisabled={busy !== null}
            onPress={() => void onSaveSettings()}
          >
            <BusyLabel busy={busy === 'save'} busyText="Salvando…">
              Salvar prazo e política
            </BusyLabel>
          </Button>
        </div>
      </section>
    </div>
  )
}
