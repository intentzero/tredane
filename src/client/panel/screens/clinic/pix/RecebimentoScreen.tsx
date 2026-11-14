/**
 * M-33 — Recebimento de sinais (conta Woovi + cartão unificado do sinal).
 * Só owner (área Clínica). DEC-175 faixa + cartões; DEC-180 cartão unificado;
 * DEC-182 prazo 15/30, antecedência mínima, janela com Outro… (min|h dropdown).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Input,
  Label,
  Switch,
  TextArea,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from 'react-aria-components'
import type { PanelApi, PixSnapshot, PixSignalSettings } from '../../../api'
import { PanelApiError } from '../../../api'
import { ErrorState } from '../../../states/StatusScreens'
import { friendlyError } from '../../../copy/errors'
import { Banner } from '../../../states/Banner'
import { ClinicSkeleton } from '../ClinicSkeleton'
import { BusyLabel, CardNotice, type CardNoticeValue } from '../CardFooter'
import {
  BOOKING_LEAD_PRESETS_MINUTES,
  CREDIT_WINDOW_PRESETS_MINUTES,
  DEFAULT_SIGNAL_DEADLINE_MINUTES,
  OTHER_CREDIT_WINDOW_SEED_MINUTES,
  OTHER_LEAD_SEED_MINUTES,
  SIGNAL_DEADLINE_PRESETS_MINUTES,
  combineCustomDeadline,
  formatDeadlinePresetLabel,
  isBookingLeadPreset,
  isCreditWindowPreset,
  isCustomDurationValid,
  isDeadlineMinutesValid,
  isDeadlinePreset,
  minutesToSeconds,
  normalizeDeadlineMinutes,
  sanitizeCustomAmountInput,
  secondsToMinutes,
  splitCustomDeadline,
  type DeadlineUnit,
} from './deadlinePresets'
import { buildSignalPolicyPreview } from '../../../../../clinic/pix/signal-policy-text'

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
}

type Busy = null | 'connect' | 'disconnect' | 'save'
type Notice = CardNoticeValue & { card: 'account' | 'policy' }

type CustomDurationState = {
  minutes: number
  custom: boolean
  amount: string
  unit: DeadlineUnit
}

type PolicyKind = PixSignalSettings['policyKind']
type AmountKind = PixSignalSettings['amountKind']

function fromMinutes(
  minutes: number,
  isPreset: (m: number) => boolean,
  otherSeed: number,
): CustomDurationState {
  if (isPreset(minutes)) {
    const seed = splitCustomDeadline(otherSeed)
    return { minutes, custom: false, amount: String(seed.amount), unit: seed.unit }
  }
  const split = splitCustomDeadline(minutes > 0 ? minutes : otherSeed)
  return {
    minutes: minutes > 0 ? minutes : otherSeed,
    custom: true,
    amount: String(split.amount),
    unit: split.unit,
  }
}

function fromDeadlineSeconds(deadlineSeconds: number): CustomDurationState {
  const normalized = normalizeDeadlineMinutes(secondsToMinutes(deadlineSeconds))
  return fromMinutes(normalized, isDeadlinePreset, DEFAULT_SIGNAL_DEADLINE_MINUTES)
}

function formatFixedInput(cents: number | null): string {
  if (cents == null || !Number.isFinite(cents)) return '50,00'
  const reais = Math.trunc(cents / 100)
  const rest = Math.abs(cents % 100)
    .toString()
    .padStart(2, '0')
  return `${reais},${rest}`
}

function parseFixedCents(raw: string): number | null {
  const normalized = raw.trim().replace(/\./g, '').replace(',', '.')
  if (!normalized) return null
  const value = Number(normalized)
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.round(value * 100)
}

function leadLabel(minutes: number): string {
  if (minutes === 0) return 'Desligado'
  if (minutes === 30) return '30 minutos'
  if (minutes === 60) return '1 hora'
  return formatDeadlinePresetLabel(minutes)
}

function creditWindowLabel(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60} h antes`
  return `${minutes} min antes`
}

function CustomDurationFields({
  label,
  hint,
  state,
  onAmount,
  onUnit,
  ariaLabel,
}: {
  label: string
  hint: string
  state: CustomDurationState
  onAmount: (raw: string) => void
  onUnit: (unit: DeadlineUnit) => void
  ariaLabel: string
}) {
  return (
    <div className="clinic-deadline-custom" aria-label={ariaLabel}>
      <span className="clinic-deadline-label">{label}</span>
      <div className="clinic-deadline-custom-row clinic-deadline-custom-row--inline">
        <TextField className="clinic-field clinic-deadline-amount clinic-deadline-amount--compact">
          <Label>Número</Label>
          <Input
            type="text"
            inputMode="numeric"
            maxLength={2}
            value={state.amount}
            onChange={(e) => onAmount(sanitizeCustomAmountInput(e.target.value))}
            aria-label="Número"
          />
        </TextField>
        <label className="clinic-deadline-unit-select">
          <span className="clinic-deadline-label">Unidade</span>
          <select
            aria-label="Unidade"
            value={state.unit}
            onChange={(e) => {
              const next = e.target.value
              if (next === 'min' || next === 'h') onUnit(next)
            }}
          >
            <option value="min">min</option>
            <option value="h">h</option>
          </select>
        </label>
      </div>
      <span className="clinic-footnote">{hint}</span>
    </div>
  )
}

export function RecebimentoScreen({ tenantId, api, generation }: Props) {
  const [snap, setSnap] = useState<PixSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [appId, setAppId] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [amountKind, setAmountKind] = useState<AmountKind>('fixed')
  const [fixedText, setFixedText] = useState('50,00')
  const [percentText, setPercentText] = useState('30')
  const [deadline, setDeadline] = useState<CustomDurationState>(() =>
    fromDeadlineSeconds(DEFAULT_SIGNAL_DEADLINE_MINUTES * 60),
  )
  const [lead, setLead] = useState<CustomDurationState>(() =>
    fromMinutes(0, isBookingLeadPreset, OTHER_LEAD_SEED_MINUTES),
  )
  const [policyKind, setPolicyKind] = useState<PolicyKind>('credit_next')
  const [creditWindow, setCreditWindow] = useState<CustomDurationState>(() =>
    fromMinutes(24 * 60, isCreditWindowPreset, OTHER_CREDIT_WINDOW_SEED_MINUTES),
  )
  const [customPolicy, setCustomPolicy] = useState('')
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
      const s = next.signalSettings
      setEnabled(s.enabled ?? false)
      setAmountKind(s.amountKind ?? 'fixed')
      setFixedText(formatFixedInput(s.fixedCents ?? 5000))
      setPercentText(String(s.percent ?? 30))
      setDeadline(fromDeadlineSeconds(s.deadlineSeconds))
      setLead(
        fromMinutes(s.bookingLeadMinutes ?? 0, isBookingLeadPreset, OTHER_LEAD_SEED_MINUTES),
      )
      setPolicyKind(s.policyKind ?? 'credit_next')
      const windowMins =
        s.creditWindowMinutes
        ?? (s.creditWindowHours != null ? s.creditWindowHours * 60 : 24 * 60)
      setCreditWindow(
        fromMinutes(windowMins, isCreditWindowPreset, OTHER_CREDIT_WINDOW_SEED_MINUTES),
      )
      setCustomPolicy(s.customPolicyText ?? '')
    } catch (err) {
      if (err instanceof PanelApiError && err.message === 'stale_tenant_response') return
      setError(friendlyError(err, 'Não conseguimos carregar. Tente de novo.'))
    }
  }, [api, tenantId, generation])

  useEffect(() => {
    void reload()
  }, [reload])

  const deadlineMinutes = deadline.minutes
  const leadMinutes = lead.custom
    ? combineCustomDeadline(Number(lead.amount), lead.unit)
    : lead.minutes
  const creditMinutes = creditWindow.custom
    ? combineCustomDeadline(Number(creditWindow.amount), creditWindow.unit)
    : creditWindow.minutes

  const deadlineValid = isDeadlineMinutesValid(deadlineMinutes)
  const leadValid = leadMinutes === 0 || isCustomDurationValid(leadMinutes)
  const creditValid =
    policyKind !== 'credit_next' || isCustomDurationValid(creditMinutes)
  const fixedCents = parseFixedCents(fixedText)
  const percent = Number.parseInt(percentText, 10)
  const amountValid =
    amountKind === 'fixed'
      ? fixedCents != null && fixedCents > 0
      : Number.isInteger(percent) && percent >= 1 && percent <= 100
  const customOk = policyKind !== 'custom' || customPolicy.trim().length > 0
  const saveDisabled =
    busy !== null
    || !deadlineValid
    || !leadValid
    || !creditValid
    || (enabled && (!amountValid || !customOk))

  const livePreview = useMemo(() => {
    if (!deadlineValid) return null
    return buildSignalPolicyPreview({
      amountKind,
      fixedCents: amountKind === 'fixed' ? fixedCents : null,
      percent: amountKind === 'percent' && Number.isInteger(percent) ? percent : null,
      deadlineSeconds: minutesToSeconds(deadlineMinutes),
      policyKind,
      creditWindowMinutes: policyKind === 'credit_next' ? creditMinutes : null,
      customPolicyText: customPolicy,
    })
  }, [
    amountKind,
    fixedCents,
    percent,
    deadlineValid,
    deadlineMinutes,
    policyKind,
    creditMinutes,
    customPolicy,
  ])

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

  function pickDeadline(minutes: number) {
    setDeadline((prev) => ({ ...prev, minutes, custom: false }))
    setNotice(null)
  }

  function pickLeadPreset(minutes: number) {
    setLead((prev) => ({ ...prev, minutes, custom: false }))
    setNotice(null)
  }

  function pickLeadOther() {
    setLead((prev) => {
      if (prev.custom) return prev
      const seed = OTHER_LEAD_SEED_MINUTES
      const split = splitCustomDeadline(seed)
      return { minutes: seed, custom: true, amount: String(split.amount), unit: split.unit }
    })
    setNotice(null)
  }

  function setLeadAmount(raw: string) {
    setLead((prev) => {
      const combined = combineCustomDeadline(Number(raw), prev.unit)
      return { ...prev, custom: true, amount: raw, minutes: combined ?? prev.minutes }
    })
  }

  function setLeadUnit(unit: DeadlineUnit) {
    setLead((prev) => {
      const combined = combineCustomDeadline(Number(prev.amount), unit)
      return { ...prev, custom: true, unit, minutes: combined ?? prev.minutes }
    })
  }

  function pickCreditPreset(minutes: number) {
    setCreditWindow((prev) => ({ ...prev, minutes, custom: false }))
    setNotice(null)
  }

  function pickCreditOther() {
    setCreditWindow((prev) => {
      if (prev.custom) return prev
      const seed = OTHER_CREDIT_WINDOW_SEED_MINUTES
      const split = splitCustomDeadline(seed)
      return { minutes: seed, custom: true, amount: String(split.amount), unit: split.unit }
    })
    setNotice(null)
  }

  function setCreditAmount(raw: string) {
    setCreditWindow((prev) => {
      const combined = combineCustomDeadline(Number(raw), prev.unit)
      return { ...prev, custom: true, amount: raw, minutes: combined ?? prev.minutes }
    })
  }

  function setCreditUnit(unit: DeadlineUnit) {
    setCreditWindow((prev) => {
      const combined = combineCustomDeadline(Number(prev.amount), unit)
      return { ...prev, custom: true, unit, minutes: combined ?? prev.minutes }
    })
  }

  async function onSaveSettings() {
    if (saveDisabled || leadMinutes == null || creditMinutes == null) return
    setBusy('save')
    setNotice(null)
    try {
      const signalSettings = await api.updatePixSignalSettings(
        tenantId,
        {
          enabled,
          amountKind,
          fixedCents: amountKind === 'fixed' ? fixedCents : null,
          percent: amountKind === 'percent' ? percent : null,
          deadlineSeconds: minutesToSeconds(deadlineMinutes),
          policyKind,
          creditWindowMinutes: policyKind === 'credit_next' ? creditMinutes : null,
          bookingLeadMinutes: leadMinutes,
          customPolicyText: policyKind === 'custom' ? customPolicy.trim() : '',
        },
        { generation, expectGeneration: () => generation },
      )
      setSnap((prev) =>
        prev ? { ...prev, signalSettings } : { account: snap!.account, signalSettings },
      )
      setDeadline(fromDeadlineSeconds(signalSettings.deadlineSeconds))
      setLead(
        fromMinutes(
          signalSettings.bookingLeadMinutes ?? 0,
          isBookingLeadPreset,
          OTHER_LEAD_SEED_MINUTES,
        ),
      )
      const savedWindow =
        signalSettings.creditWindowMinutes
        ?? (signalSettings.creditWindowHours != null
          ? signalSettings.creditWindowHours * 60
          : 24 * 60)
      setCreditWindow(
        fromMinutes(savedWindow, isCreditWindowPreset, OTHER_CREDIT_WINDOW_SEED_MINUTES),
      )
      setNotice({ card: 'policy', tone: 'ok', text: 'Regras do sinal salvas.' })
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
  const leadOtherPressed = lead.custom || !isBookingLeadPreset(lead.minutes)
  const creditOtherPressed =
    creditWindow.custom || !isCreditWindowPreset(creditWindow.minutes)

  return (
    <div className="clinic-stack">
      {connected ? (
        <Banner tone="ok" title="Conta conectada">
          <p>
            Woovi · {snap.account.appIdHint} · versão {snap.account.credentialVersion}. Os sinais
            caem na conta da clínica.
          </p>
        </Banner>
      ) : (
        <Banner tone="warn" title={revoked ? 'Credencial revogada' : 'Sem conta conectada'}>
          <p>
            Sem conta, não dá para enviar cobrança. A atendente ainda pode confirmar sem sinal, com
            motivo, ou dispensar no Contato.
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

      <section className="panel-card clinic-card" aria-labelledby="pix-sinal">
        <h2 id="pix-sinal" className="panel-title-md">
          Sinal para reservar o horário
        </h2>
        <p className="clinic-footnote" style={{ marginTop: 0 }}>
          O sinal é um Pix que a cliente paga para o horário deixar de ficar livre. Até pagar, o
          horário continua disponível. Só a responsável altera estas regras.
        </p>

        <div className="clinic-signal-toggle">
          <div className="clinic-signal-toggle-copy">
            <span className="clinic-deadline-label">Pedir sinal ao agendar</span>
            <span className="clinic-footnote">
              Desligado: some a UI de sinal nos serviços e no Agendar.
            </span>
          </div>
          <Switch
            className="clinic-switch"
            isSelected={enabled}
            onChange={setEnabled}
            aria-label="Pedir sinal ao agendar"
          >
            <span className="clinic-switch-track" aria-hidden>
              <span className="clinic-switch-thumb" />
            </span>
          </Switch>
        </div>

        {enabled ? (
          <>
            <div className="clinic-deadline" role="group" aria-labelledby="pix-amount-label">
              <span id="pix-amount-label" className="clinic-deadline-label">
                Valor do sinal (toda a clínica)
              </span>
              <ToggleButtonGroup
                className="panel-segmented"
                aria-label="Tipo de valor"
                selectionMode="single"
                selectedKeys={new Set([amountKind])}
                onSelectionChange={(keys) => {
                  const next = [...keys][0]
                  if (next === 'fixed' || next === 'percent') setAmountKind(next)
                }}
              >
                <ToggleButton id="fixed" className="panel-segmented-item">
                  Valor fixo (R$)
                </ToggleButton>
                <ToggleButton id="percent" className="panel-segmented-item">
                  % do serviço
                </ToggleButton>
              </ToggleButtonGroup>
              {amountKind === 'fixed' ? (
                <TextField className="clinic-field clinic-signal-money">
                  <Label>Valor em reais</Label>
                  <div className="clinic-signal-money-row">
                    <span aria-hidden>R$</span>
                    <Input
                      value={fixedText}
                      onChange={(e) => setFixedText(e.target.value)}
                      inputMode="decimal"
                    />
                  </div>
                </TextField>
              ) : (
                <TextField className="clinic-field">
                  <Label>Percentual (1–100)</Label>
                  <Input
                    value={percentText}
                    onChange={(e) => setPercentText(e.target.value)}
                    inputMode="numeric"
                  />
                </TextField>
              )}
              <span className="clinic-footnote">
                Um valor global — não há sinal por serviço neste desenho. Em %, o sistema calcula
                sobre o preço do serviço no Agendar.
              </span>
            </div>

            <div className="clinic-deadline" role="group" aria-labelledby="pix-deadline-label">
              <span id="pix-deadline-label" className="clinic-deadline-label">
                Prazo para a cliente pagar o sinal
              </span>
              <div
                className="clinic-deadline-presets clinic-deadline-presets--2"
                role="group"
                aria-label="Presets de prazo"
              >
                {SIGNAL_DEADLINE_PRESETS_MINUTES.map((m) => {
                  const pressed = deadlineMinutes === m
                  return (
                    <button
                      key={m}
                      type="button"
                      className="clinic-deadline-chip"
                      aria-pressed={pressed}
                      onClick={() => pickDeadline(m)}
                    >
                      {formatDeadlinePresetLabel(m)}
                    </button>
                  )
                })}
              </div>
              <span className="clinic-footnote">
                Padrão 30 min. Cobranças já enviadas mantêm o prazo original.
              </span>
            </div>

            <div className="clinic-deadline" role="group" aria-labelledby="pix-lead-label">
              <span id="pix-lead-label" className="clinic-deadline-label">
                Antecedência mínima do agendamento
              </span>
              <div className="clinic-deadline-presets clinic-deadline-presets--wrap" role="group" aria-label="Antecedência mínima">
                {BOOKING_LEAD_PRESETS_MINUTES.map((m) => {
                  const pressed = !leadOtherPressed && lead.minutes === m
                  return (
                    <button
                      key={m}
                      type="button"
                      className="clinic-deadline-chip"
                      aria-pressed={pressed}
                      onClick={() => pickLeadPreset(m)}
                    >
                      {leadLabel(m)}
                    </button>
                  )
                })}
                <button
                  type="button"
                  className="clinic-deadline-chip"
                  aria-pressed={leadOtherPressed}
                  onClick={() => pickLeadOther()}
                >
                  Outro…
                </button>
              </div>
              {leadOtherPressed ? (
                <CustomDurationFields
                  label="Antecedência personalizada"
                  hint="Exemplo: 2 h. A oferta e o Agendar só mostram horários com pelo menos esta margem."
                  state={lead}
                  onAmount={setLeadAmount}
                  onUnit={setLeadUnit}
                  ariaLabel="Antecedência personalizada"
                />
              ) : (
                <span className="clinic-footnote">
                  Desligado: a cliente pode marcar o horário mais próximo disponível. Com valor, a
                  oferta e o Agendar só mostram horários a partir desta margem.
                </span>
              )}
            </div>

            <div className="clinic-deadline" role="group" aria-labelledby="pix-policy-label">
              <span id="pix-policy-label" className="clinic-deadline-label">
                Se cancelar ou remarcar depois de pagar
              </span>
              <div className="clinic-policy-chips" role="group" aria-label="Política">
                <button
                  type="button"
                  className="clinic-policy-chip"
                  aria-pressed={policyKind === 'credit_next'}
                  onClick={() => setPolicyKind('credit_next')}
                >
                  <strong>Aplica no próximo horário</strong>
                  <small>O valor fica como crédito — sem devolver Pix (taxas do provedor)</small>
                </button>
                <button
                  type="button"
                  className="clinic-policy-chip"
                  aria-pressed={policyKind === 'keep'}
                  onClick={() => setPolicyKind('keep')}
                >
                  <strong>Não devolve</strong>
                  <small>O sinal fica com a clínica</small>
                </button>
                <button
                  type="button"
                  className="clinic-policy-chip"
                  aria-pressed={policyKind === 'custom'}
                  onClick={() => setPolicyKind('custom')}
                >
                  <strong>Outro…</strong>
                  <small>Sobrescreve o texto gerado</small>
                </button>
              </div>

              {policyKind === 'credit_next' ? (
                <div className="clinic-credit-window">
                  <span className="clinic-deadline-label">
                    Janela para cancelar / remarcar com crédito
                  </span>
                  <div
                    className="clinic-deadline-presets clinic-deadline-presets--wrap"
                    role="group"
                    aria-label="Janela"
                  >
                    {CREDIT_WINDOW_PRESETS_MINUTES.map((m) => (
                      <button
                        key={m}
                        type="button"
                        className="clinic-deadline-chip"
                        aria-pressed={!creditOtherPressed && creditWindow.minutes === m}
                        onClick={() => pickCreditPreset(m)}
                      >
                        {creditWindowLabel(m)}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="clinic-deadline-chip"
                      aria-pressed={creditOtherPressed}
                      onClick={() => pickCreditOther()}
                    >
                      Outro…
                    </button>
                  </div>
                  {creditOtherPressed ? (
                    <CustomDurationFields
                      label="Janela personalizada"
                      hint="Exemplo: 36 h antes. Só com «Aplica no próximo horário»."
                      state={creditWindow}
                      onAmount={setCreditAmount}
                      onUnit={setCreditUnit}
                      ariaLabel="Janela personalizada"
                    />
                  ) : (
                    <span className="clinic-footnote">
                      Só com «Aplica no próximo horário». Aviso depois desta janela: crédito não se
                      aplica.
                    </span>
                  )}
                </div>
              ) : null}

              {policyKind === 'custom' ? (
                <TextField className="clinic-field">
                  <Label>Texto que a cliente vê</Label>
                  <TextArea
                    value={customPolicy}
                    onChange={(e) => setCustomPolicy(e.target.value)}
                    rows={5}
                    placeholder="Escreva a política de agendamento, remarcação e cancelamento…"
                  />
                </TextField>
              ) : livePreview ? (
                <div className="clinic-signal-preview" role="status" aria-live="polite">
                  <span className="clinic-signal-preview-tag">Texto gerado · a cliente vê isto</span>
                  <strong>Prévia automática (prazo · valor · política)</strong>
                  <div className="clinic-signal-preview-block">
                    <em>Agendamento</em>
                    <p>{livePreview.booking}</p>
                  </div>
                  <div className="clinic-signal-preview-block">
                    <em>Reagendamento</em>
                    <p>{livePreview.reschedule}</p>
                  </div>
                  <div className="clinic-signal-preview-block">
                    <em>Cancelamento</em>
                    <p>{livePreview.cancel}</p>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <p className="clinic-footnote">
            As regras ficam guardadas. Ao ligar de novo, valor, prazo e política voltam a aparecer.
          </p>
        )}

        <div className="clinic-card-footer">
          <CardNotice notice={policyNotice} />
          <Button
            className="panel-btn-primary"
            isDisabled={saveDisabled}
            onPress={() => void onSaveSettings()}
          >
            <BusyLabel busy={busy === 'save'} busyText="Salvando…">
              Salvar regras do sinal
            </BusyLabel>
          </Button>
        </div>
        <p className="clinic-footnote">
          Atendentes não editam esta tela — só podem dispensar o sinal num Contato.
        </p>
      </section>
    </div>
  )
}
