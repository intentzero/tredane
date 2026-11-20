import { useEffect, useRef, useState } from 'react'
import { useMediaQuery } from '../../ui/useMediaQuery'
import { ShellSlot } from '../../shell/ShellSlot'
import { Button, Input, Label, Text, TextArea, TextField } from 'react-aria-components'
import { PanelApiError, type PanelApi } from '../../api'
import { friendlyError } from '../../copy/errors'
import { navigatePanel } from '../../routes'
import {
  checkGoogleBusinessUrl,
  GOOGLE_BUSINESS_URL_MAX_LENGTH,
} from '../../../../clinic/config/google-business-link'
import { GENERAL_POLICY_MAX_CHARS, joinPolicyParts } from '../../../../clinic/ai/policy-join'
import {
  analyzeGeneralPolicyConflict,
  formatPolicyConflictMessage,
} from '../../../../clinic/ai/policy-conflict'

/**
 * Opt-in de IA por clínica (política de privacidade §6). Default desligado.
 * Sem opt-in nada sai sozinho: nem respostas, nem preço, nem «Abrir agenda».
 */
export function AiAssistCard({
  tenantId,
  api,
  generation,
  initialEnabled,
}: {
  tenantId: string
  api: PanelApi
  generation: number
  initialEnabled: boolean
}) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // M-74: «Salvo» por um instante depois de o interruptor gravar.
  const [saved, setSaved] = useState(false)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current)
  }, [])

  async function toggle(next: boolean) {
    setBusy(true)
    setError(null)
    try {
      const s = await api.setClinicAiAssist(tenantId, next, {
        generation,
        expectGeneration: () => generation,
      })
      setEnabled(s.aiAssistEnabled === true)
      setSaved(true)
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setSaved(false), 2000)
    } catch {
      setError('Não foi possível salvar. Tente de novo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel-card" aria-labelledby="ai-optin-t">
      <h2 id="ai-optin-t" className="panel-title-md">
        Atendimento automático no WhatsApp
      </h2>
      <label className="panel-switch-row">
        <span>
          <span className="panel-switch-label">
            {enabled ? 'Ligado' : 'Desligado'}
          </span>
          <span className="panel-muted-sm">
            {enabled
              ? 'Responde sozinha com o que você cadastrou: preços, horário, localização e respostas da clínica. Para marcar, remarcar ou cancelar, envia o botão «Abrir agenda».'
              : 'Nada sai sozinho. A equipe responde tudo e envia o link da agenda pelo painel.'}
          </span>
        </span>
        {saved ? (
          <span className="panel-saved-flash" role="status">
            Salvo
          </span>
        ) : null}
        <input
          type="checkbox"
          role="switch"
          className="panel-switch"
          checked={enabled}
          disabled={busy}
          aria-checked={enabled}
          onChange={(e) => void toggle(e.target.checked)}
          aria-label="Atendimento automático no WhatsApp"
        />
      </label>
      <details className="ai-optin-more">
        <summary>Como funciona e o que acontece com as mensagens</summary>
        <p className="panel-muted-sm">
          Marcar, remarcar e cancelar são só na agenda online da cliente; o chat informa e envia o
          botão «Abrir agenda». As mensagens não ficam guardadas pelo provedor de IA nem são usadas
          para treinar modelos.
        </p>
      </details>
      {error ? (
        <p className="clinic-footnote clinic-footnote-warn" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}

type ProfileProps = {
  tenantId: string
  api: PanelApi
  generation: number
  initialGoogleBusinessUrl?: string | null
  initialReschedulePolicy?: string | null
  onSaved?: () => void
}

const GB_INVALID_MESSAGE = `Link da localização inválido: use um link https:// com até ${GOOGLE_BUSINESS_URL_MAX_LENGTH} caracteres.`

/**
 * Factos da clínica que a owner edita (DEC-210/211): localização e regras gerais.
 * Revisão DEC-210: B só se precisar (Q4); conflito com o Recebimento bloqueia gravar (U1);
 * legado conflituoso só avisa no painel (Q3).
 */
export function AiProfileCard({
  tenantId,
  api,
  generation,
  initialGoogleBusinessUrl = null,
  initialReschedulePolicy = null,
  onSaved,
}: ProfileProps) {
  const [gbUrl, setGbUrl] = useState(initialGoogleBusinessUrl ?? '')
  const [gbError, setGbError] = useState<string | null>(null)
  const [policy, setPolicy] = useState(initialReschedulePolicy ?? '')
  const [baseline, setBaseline] = useState({
    gbUrl: initialGoogleBusinessUrl ?? '',
    policy: initialReschedulePolicy ?? '',
  })
  const wide = useMediaQuery('(min-width: 1280px)')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  // Com os dois campos preenchidos, o cartão abre como resumo (uma linha por campo).
  const [editing, setEditing] = useState(false)
  // Q4: com sinal ligado e B vazio, o campo começa colapsado («só se precisar»).
  const [policyOpen, setPolicyOpen] = useState(() => Boolean((initialReschedulePolicy ?? '').trim()))
  // Texto do sinal (Recebimento), só leitura: entra primeiro na resposta «Remarcar e cancelar».
  const [signalText, setSignalText] = useState<string | null>(null)
  const [signalOn, setSignalOn] = useState(false)
  const [signalLoaded, setSignalLoaded] = useState(false)
  useEffect(() => {
    let cancelled = false
    void Promise.resolve(api.getPix?.(tenantId, { generation, expectGeneration: () => generation }))
      .then((pix) => {
        if (cancelled || !pix) return
        const s = pix.signalSettings
        setSignalOn(s.enabled === true)
        setSignalText(s.enabled ? s.cancellationPolicy.trim() : '')
        setSignalLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setSignalLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [api, tenantId, generation])

  const dirty = gbUrl !== baseline.gbUrl || policy !== baseline.policy
  const conflict = analyzeGeneralPolicyConflict(policy, { signalOn })
  const conflictMessage = formatPolicyConflictMessage(conflict)
  const saveBlocked = conflict.blocksSave
  // Com sinal desligado, B é a fonte — campo visível. Com sinal ligado e B vazio: colapsado (Q4).
  const showPolicyField =
    !signalLoaded || !signalOn || policyOpen || Boolean(policy.trim())

  function discard() {
    setGbUrl(baseline.gbUrl)
    setPolicy(baseline.policy)
    setPolicyOpen(Boolean(baseline.policy.trim()) || !signalOn)
    setGbError(null)
    setNote(null)
  }

  async function save() {
    setNote(null)
    setGbError(null)
    if (saveBlocked) {
      setNote(conflictMessage)
      return
    }
    const gb = checkGoogleBusinessUrl(gbUrl)
    if (!gb.ok) {
      setGbError(gb.message)
      return
    }
    setBusy(true)
    try {
      await api.setClinicAiProfile(
        tenantId,
        { googleBusinessUrl: gb.value, reschedulePolicy: policy.trim() },
        { generation, expectGeneration: () => generation },
      )
      setBaseline({ gbUrl, policy })
      setPolicyOpen(Boolean(policy.trim()) || !signalOn)
      setEditing(false)
      setNote('Salvo.')
      onSaved?.()
    } catch (err) {
      if (err instanceof PanelApiError && err.status === 400) {
        if (String(err.code) === 'reschedule_policy_conflicts_with_signal') {
          setNote(conflictMessage || friendlyError(err, 'Confira as regras gerais e tente de novo.'))
        } else if (String(err.code) === 'invalid_google_business_url') {
          setGbError(GB_INVALID_MESSAGE)
        } else {
          setNote(friendlyError(err, 'Não foi possível salvar. Tente de novo.'))
        }
      } else {
        setNote(friendlyError(err, 'Não foi possível salvar. Tente de novo.'))
      }
    } finally {
      setBusy(false)
    }
  }

  const saveLabel = 'Salvar localização e regras'
  const policyPreview = joinPolicyParts(signalText ?? '', policy)
  const saveDisabled = busy || !dirty || saveBlocked

  const actions = wide ? (
    // DEC-183: no desktop, «Salvar» e «Descartar» ficam no cabeçalho, sempre à vista.
    <ShellSlot>
      <div className="clinic-bar-ctx">
        {dirty ? (
          <span className="clinic-bar-pill clinic-bar-pill--warn" role="status">
            Alterações por salvar
          </span>
        ) : null}
        <span className="clinic-bar-action clinic-bar-action--row">
          <Button className="panel-btn panel-btn-ghost" onPress={discard} isDisabled={busy || !dirty}>
            Descartar
          </Button>
          <Button
            className="panel-btn panel-btn-primary"
            onPress={() => void save()}
            isDisabled={saveDisabled}
          >
            {busy ? 'Salvando…' : saveLabel}
          </Button>
        </span>
      </div>
    </ShellSlot>
  ) : (
    <Button
      className="panel-btn panel-btn-secondary"
      onPress={() => void save()}
      isDisabled={saveDisabled}
    >
      {busy ? 'Salvando…' : saveLabel}
    </Button>
  )

  if (!editing && !dirty && baseline.gbUrl.trim() && baseline.policy.trim()) {
    const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s)
    const baselineConflict = analyzeGeneralPolicyConflict(baseline.policy, { signalOn })
    return (
      <section className="panel-card" aria-labelledby="ai-profile-facts-t">
        <div className="panel-switch-row">
          <h2 id="ai-profile-facts-t" className="panel-title-md">
            Sobre a clínica
          </h2>
          <Button className="panel-btn panel-btn-secondary" onPress={() => setEditing(true)}>
            Editar
          </Button>
        </div>
        {baselineConflict.blocksSave ? (
          <p className="clinic-footnote clinic-footnote-warn" role="status">
            {formatPolicyConflictMessage(baselineConflict)}{' '}
            <Button
              className="panel-btn panel-btn-ghost"
              onPress={() =>
                navigatePanel({ kind: 'area', area: 'clinica', tenantId, section: 'recebimento' })
              }
            >
              Abrir Recebimento
            </Button>
          </p>
        ) : null}
        <dl className="kn-summary">
          <div>
            <dt>Localização</dt>
            <dd>{short(baseline.gbUrl.replace(/^https?:\/\//, ''), 48)}</dd>
          </div>
          <div>
            <dt>Remarcar e cancelar</dt>
            <dd>{short(baseline.policy, 80)}</dd>
          </div>
        </dl>
      </section>
    )
  }

  return (
    <section className="panel-card" aria-labelledby="ai-profile-facts-t">
      <h2 id="ai-profile-facts-t" className="panel-title-md">
        Sobre a clínica
      </h2>
      <TextField
        className="clinic-field"
        isInvalid={gbError != null}
        value={gbUrl}
        onChange={(v) => {
          setGbUrl(v)
          if (gbError) setGbError(null)
        }}
      >
        <Label>Localização: link da localização Google</Label>
        <Input
          type="url"
          inputMode="url"
          placeholder="https://maps.app.goo.gl/…"
          maxLength={GOOGLE_BUSINESS_URL_MAX_LENGTH}
        />
        <Text slot="description" className="panel-muted-sm">
          Cole o link da localização no Google Maps (preferível o curto maps.app.goo.gl). Enviado
          quando a cliente pede o local, na confirmação do chat e na página da cliente («Como
          chegar»).
        </Text>
        {gbError ? (
          <p className="clinic-footnote clinic-footnote-warn" role="alert">
            {gbError}
          </p>
        ) : null}
      </TextField>
      {showPolicyField ? (
        <TextField className="clinic-field">
          <Label>Regras gerais de remarcação e cancelamento</Label>
          <TextArea
            value={policy}
            onChange={(e) => setPolicy(e.target.value)}
            rows={3}
            maxLength={GENERAL_POLICY_MAX_CHARS}
            placeholder={
              signalOn
                ? 'Ex.: Atrasos acima de 15 minutos podem perder o horário.'
                : 'Ex.: Avise com 24 h de antecedência. Atrasos acima de 15 minutos podem perder o horário.'
            }
          />
          <Text slot="description" className="panel-muted-sm">
            {signalOn
              ? 'Atrasos e faltas. Prazos de cancelar/remarcar, valor, crédito e «não devolve» ficam só em Recebimento do sinal.'
              : 'Aviso prévio, atrasos, faltas.'}{' '}
            {policy.length}/{GENERAL_POLICY_MAX_CHARS}
          </Text>
        </TextField>
      ) : (
        <div className="clinic-field">
          <Button className="panel-btn panel-btn-secondary" onPress={() => setPolicyOpen(true)}>
            Adicionar regras de atraso e falta
          </Button>
          <p className="panel-muted-sm">
            Opcional. Prazos de cancelar/remarcar e regras de dinheiro ficam em Recebimento do sinal.
          </p>
        </div>
      )}
      {conflictMessage ? (
        <p className="clinic-footnote clinic-footnote-warn" role="alert">
          {conflictMessage}{' '}
          <Button
            className="panel-btn panel-btn-ghost"
            onPress={() =>
              navigatePanel({ kind: 'area', area: 'clinica', tenantId, section: 'recebimento' })
            }
          >
            Abrir Recebimento
          </Button>
        </p>
      ) : null}
      <section className="kn-preview" aria-labelledby="policy-prev-t">
        <h3 id="policy-prev-t" className="kn-sub">
          Como a cliente recebe «Remarcar e cancelar»
        </h3>
        <div className="kn-preview-pane">
          <p className="kn-bubble kn-bubble--out">
            {policyPreview || 'Sem regras cadastradas: a pergunta passa para a equipe.'}
          </p>
          <span className="kn-preview-note">
            {signalText
              ? 'A parte do sinal vem do Recebimento e se edita lá. Regras gerais de atraso/falta vêm a seguir, sem repetir estes prazos.'
              : 'Sem sinal ligado, só saem as regras gerais.'}
          </span>
        </div>
      </section>
      {actions}
      {note ? (
        <p className="clinic-footnote" role="status">
          {note}
        </p>
      ) : null}
    </section>
  )
}
