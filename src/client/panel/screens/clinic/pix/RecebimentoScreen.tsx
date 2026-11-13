/**
 * M-33 — Recebimento de sinais (conta Woovi + prazo + política).
 * Só owner (área Clínica). Cobrança na conversa = Agendar / #38.
 * DEC-175: estado em faixa, um cartão por decisão, resposta junto do botão.
 * DEC-179: prazo em presets + Outro… (min|h); API em deadlineSeconds.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Input, Label, TextArea, TextField, ToggleButton, ToggleButtonGroup } from 'react-aria-components'
import type { PanelApi, PixSnapshot } from '../../../api'
import { PanelApiError } from '../../../api'
import { ErrorState } from '../../../states/StatusScreens'
import { friendlyError } from '../../../copy/errors'
import { Banner } from '../../../states/Banner'
import { ClinicSkeleton } from '../ClinicSkeleton'
import { BusyLabel, CardNotice, type CardNoticeValue } from '../CardFooter'
import {
  DEFAULT_SIGNAL_DEADLINE_MINUTES,
  OTHER_DEADLINE_SEED_MINUTES,
  SIGNAL_DEADLINE_PRESETS_MINUTES,
  combineCustomDeadline,
  formatDeadlinePresetLabel,
  isDeadlineMinutesValid,
  isDeadlinePreset,
  minutesToSeconds,
  secondsToMinutes,
  splitCustomDeadline,
  type DeadlineUnit,
} from './deadlinePresets'

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
}

type Busy = null | 'connect' | 'disconnect' | 'save'
type Notice = CardNoticeValue & { card: 'account' | 'policy' }

type DeadlineState = {
  minutes: number
  custom: boolean
  amount: string
  unit: DeadlineUnit
}

function fromSeconds(deadlineSeconds: number): DeadlineState {
  const minutes = secondsToMinutes(deadlineSeconds)
  if (isDeadlinePreset(minutes)) {
    return { minutes, custom: false, amount: String(OTHER_DEADLINE_SEED_MINUTES), unit: 'min' }
  }
  const split = splitCustomDeadline(minutes)
  return {
    minutes,
    custom: true,
    amount: String(split.amount),
    unit: split.unit,
  }
}

export function RecebimentoScreen({ tenantId, api, generation }: Props) {
  const [snap, setSnap] = useState<PixSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [appId, setAppId] = useState('')
  const [deadline, setDeadline] = useState<DeadlineState>(() =>
    fromSeconds(DEFAULT_SIGNAL_DEADLINE_MINUTES * 60),
  )
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
      setDeadline(fromSeconds(next.signalSettings.deadlineSeconds))
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

  function pickPreset(minutes: number) {
    setDeadline((prev) => ({
      ...prev,
      minutes,
      custom: false,
    }))
    setNotice(null)
  }

  function pickOther() {
    setDeadline((prev) => {
      if (prev.custom) return prev
      const seed = OTHER_DEADLINE_SEED_MINUTES
      const split = splitCustomDeadline(seed)
      return {
        minutes: seed,
        custom: true,
        amount: String(split.amount),
        unit: split.unit,
      }
    })
    setNotice(null)
  }

  function setCustomAmount(raw: string) {
    setDeadline((prev) => {
      const amount = raw
      const combined = combineCustomDeadline(Number(amount), prev.unit)
      return {
        ...prev,
        custom: true,
        amount,
        minutes: combined ?? prev.minutes,
      }
    })
  }

  function setCustomUnit(unit: DeadlineUnit) {
    setDeadline((prev) => {
      const combined = combineCustomDeadline(Number(prev.amount), unit)
      return {
        ...prev,
        custom: true,
        unit,
        minutes: combined ?? prev.minutes,
      }
    })
  }

  const customMinutes = deadline.custom
    ? combineCustomDeadline(Number(deadline.amount), deadline.unit)
    : deadline.minutes
  const deadlineValid =
    customMinutes != null && isDeadlineMinutesValid(customMinutes)
  const saveDisabled = busy !== null || !deadlineValid

  async function onSaveSettings() {
    if (!deadlineValid || customMinutes == null) return
    setBusy('save')
    setNotice(null)
    const deadlineSeconds = minutesToSeconds(customMinutes)
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
      setDeadline(fromSeconds(signalSettings.deadlineSeconds))
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
  const otherPressed = deadline.custom || !isDeadlinePreset(deadline.minutes)

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

        <div className="clinic-deadline" role="group" aria-labelledby="pix-deadline-label">
          <span id="pix-deadline-label" className="clinic-deadline-label">
            Prazo para pagar
          </span>
          <div className="clinic-deadline-presets" role="group" aria-label="Presets de prazo">
            {SIGNAL_DEADLINE_PRESETS_MINUTES.map((m) => {
              const pressed = !otherPressed && deadline.minutes === m
              return (
                <button
                  key={m}
                  type="button"
                  className="clinic-deadline-chip"
                  aria-pressed={pressed}
                  onClick={() => pickPreset(m)}
                >
                  {formatDeadlinePresetLabel(m)}
                </button>
              )
            })}
            <button
              type="button"
              className="clinic-deadline-chip"
              aria-pressed={otherPressed}
              onClick={() => pickOther()}
            >
              Outro…
            </button>
          </div>
          <span className="clinic-footnote">
            Padrão: 2 h. Mínimo 15 min · máximo 48 h. Cobranças já enviadas mantêm o prazo original.
          </span>
        </div>

        {otherPressed ? (
          <div className="clinic-deadline-custom" aria-label="Prazo personalizado">
            <span className="clinic-deadline-label">Prazo personalizado</span>
            <div className="clinic-deadline-custom-row">
              <TextField className="clinic-field clinic-deadline-amount">
                <Label>Número</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={deadline.amount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  aria-describedby="pix-deadline-help"
                />
              </TextField>
              <div className="clinic-deadline-unit">
                <span className="clinic-deadline-label" id="pix-unit-label">
                  Unidade
                </span>
                <ToggleButtonGroup
                  className="panel-segmented"
                  aria-labelledby="pix-unit-label"
                  selectionMode="single"
                  selectedKeys={new Set([deadline.unit])}
                  onSelectionChange={(keys) => {
                    const next = [...keys][0]
                    if (next === 'min' || next === 'h') setCustomUnit(next)
                  }}
                >
                  <ToggleButton id="min" className="panel-segmented-item">
                    min
                  </ToggleButton>
                  <ToggleButton id="h" className="panel-segmented-item">
                    h
                  </ToggleButton>
                </ToggleButtonGroup>
              </div>
            </div>
            <span id="pix-deadline-help" className="clinic-footnote">
              {deadlineValid
                ? 'Exemplo: 90 min (= 1 h 30). Fora de 15 min–48 h o Salvar fica desabilitado.'
                : 'Prazo fora de 15 min–48 h. Ajuste o número ou a unidade para salvar.'}
            </span>
          </div>
        ) : null}

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
            isDisabled={saveDisabled}
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
