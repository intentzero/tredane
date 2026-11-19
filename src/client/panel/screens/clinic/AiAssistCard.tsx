import { useEffect, useRef, useState } from 'react'
import { useMediaQuery } from '../../ui/useMediaQuery'
import { ShellSlot } from '../../shell/ShellSlot'
import { Button, Input, Label, Radio, RadioGroup, Text, TextArea, TextField } from 'react-aria-components'
import { PanelApiError, type PanelApi } from '../../api'
import {
  checkGoogleBusinessUrl,
  GOOGLE_BUSINESS_URL_MAX_LENGTH,
} from '../../../../clinic/config/google-business-link'

type VirtualGender = 'masculino' | 'feminino' | ''

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
  initialEnabled: boolean
  initialGoogleBusinessUrl?: string | null
  initialReschedulePolicy?: string | null
  initialVirtualAttendantName?: string | null
  initialVirtualAttendantGender?: 'masculino' | 'feminino' | null
}

/**
 * Opt-in de IA por clínica (política de privacidade §6). Default desligado.
 * O servidor recusa qualquer sugestão/resumo enquanto estiver desligado.
 */
const GB_INVALID_MESSAGE = `Link do Google Business inválido: use um link https:// com até ${GOOGLE_BUSINESS_URL_MAX_LENGTH} caracteres.`

export function AiAssistCard({
  tenantId,
  api,
  generation,
  initialEnabled,
  initialGoogleBusinessUrl = null,
  initialReschedulePolicy = null,
  initialVirtualAttendantName = null,
  initialVirtualAttendantGender = null,
}: Props) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [gbUrl, setGbUrl] = useState(initialGoogleBusinessUrl ?? '')
  const [gbError, setGbError] = useState<string | null>(null)
  const [policy, setPolicy] = useState(initialReschedulePolicy ?? '')
  const [virtualName, setVirtualName] = useState(initialVirtualAttendantName ?? '')
  const [virtualGender, setVirtualGender] = useState<VirtualGender>(
    initialVirtualAttendantGender ?? '',
  )
  const [baseline, setBaseline] = useState({
    gbUrl: initialGoogleBusinessUrl ?? '',
    policy: initialReschedulePolicy ?? '',
    virtualName: initialVirtualAttendantName ?? '',
    virtualGender: (initialVirtualAttendantGender ?? '') as VirtualGender,
  })
  const wide = useMediaQuery('(min-width: 1280px)')
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileNote, setProfileNote] = useState<string | null>(null)

  const profileDirty =
    gbUrl !== baseline.gbUrl ||
    policy !== baseline.policy ||
    virtualName !== baseline.virtualName ||
    virtualGender !== baseline.virtualGender

  function discardProfile() {
    setGbUrl(baseline.gbUrl)
    setPolicy(baseline.policy)
    setVirtualName(baseline.virtualName)
    setVirtualGender(baseline.virtualGender)
    setGbError(null)
    setProfileNote(null)
  }

  async function saveProfile() {
    setProfileNote(null)
    const gb = checkGoogleBusinessUrl(gbUrl)
    if (!gb.ok) {
      setGbError(gb.message)
      return
    }
    setGbError(null)
    setProfileBusy(true)
    try {
      await api.setClinicAiProfile(
        tenantId,
        {
          googleBusinessUrl: gb.value,
          reschedulePolicy: policy.trim(),
          virtualAttendantName: virtualName.trim(),
          virtualAttendantGender: virtualGender,
        },
        { generation, expectGeneration: () => generation },
      )
      setBaseline({ gbUrl, policy, virtualName, virtualGender })
      setProfileNote('Salvo. A IA passa a usar estes dados nos rascunhos.')
    } catch (err) {
      if (err instanceof PanelApiError && err.status === 400) {
        setGbError(GB_INVALID_MESSAGE)
      } else {
        setProfileNote('Não foi possível salvar. Tente de novo.')
      }
    } finally {
      setProfileBusy(false)
    }
  }
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
        Sugestões com IA
      </h2>
      <label className="panel-switch-row">
        <span>
          <span className="panel-switch-label">Ativar sugestões de resposta</span>
          <span className="panel-muted-sm">
            A IA prepara um rascunho a cada mensagem. A equipe revisa antes de enviar.
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
          aria-label="Ativar sugestões de resposta com IA"
        />
      </label>
      {/* DEC-163: o detalhe fica atrás de «Como funciona»; a decisão cabe numa frase. */}
      <details className="ai-optin-more">
        <summary>Como funciona e o que acontece com as mensagens</summary>
        <p className="panel-muted-sm">
          Marcar, remarcar e cancelar são só na agenda online da cliente; o chat informa e envia o botão
          «Abrir agenda». As mensagens não ficam guardadas pelo provedor de IA nem são usadas para treinar modelos.
        </p>
      </details>
      {enabled ? (
        <>
          <TextField
            className="clinic-field"
            isInvalid={gbError != null}
            value={gbUrl}
            onChange={(v) => {
              setGbUrl(v)
              if (gbError) setGbError(null)
            }}
          >
            <Label>Localização: link do Google Business (opcional)</Label>
            <Input
              type="url"
              inputMode="url"
              placeholder="https://maps.app.goo.gl/…"
              maxLength={GOOGLE_BUSINESS_URL_MAX_LENGTH}
            />
            <Text slot="description" className="panel-muted-sm">
              Enviado quando a cliente pede o local, na confirmação do chat e na página da cliente («Como chegar»).
            </Text>
            {gbError ? (
              <p className="clinic-footnote clinic-footnote-warn" role="alert">
                {gbError}
              </p>
            ) : null}
          </TextField>
          <TextField className="clinic-field">
            <Label>Regras gerais de remarcação e cancelamento</Label>
            <TextArea value={policy} onChange={(e) => setPolicy(e.target.value)} rows={3} />
            <Text slot="description" className="panel-muted-sm">
              Aviso prévio, atrasos, faltas. Quando a clínica pede sinal, a regra do sinal (Recebimento)
              sai primeiro e este texto vem a seguir.
            </Text>
          </TextField>
          <TextField className="clinic-field">
            <Label>Nome do atendente virtual (opcional)</Label>
            <Input
              value={virtualName}
              onChange={(e) => setVirtualName(e.target.value)}
              maxLength={60}
              placeholder="Ex.: Luna"
            />
            <Text slot="description" className="panel-muted-sm">
              Usado na apresentação e na concordância da IA. Não grava dados da cliente.
            </Text>
          </TextField>
          <RadioGroup
            className="tempo-fieldset clinic-field"
            value={virtualGender || 'nenhum'}
            onChange={(v) =>
              setVirtualGender(v === 'masculino' || v === 'feminino' ? v : '')
            }
          >
            <Label>Género do atendente virtual</Label>
            <Radio value="nenhum" className="tempo-radio">
              <span className="tempo-radio-dot" aria-hidden="true" />
              Neutro
            </Radio>
            <Radio value="feminino" className="tempo-radio">
              <span className="tempo-radio-dot" aria-hidden="true" />
              Feminino
            </Radio>
            <Radio value="masculino" className="tempo-radio">
              <span className="tempo-radio-dot" aria-hidden="true" />
              Masculino
            </Radio>
            <Text slot="description" className="panel-muted-sm">
              Escolha e depois toque em «Salvar dados para a IA».
            </Text>
          </RadioGroup>
          {wide ? (
            // DEC-183: no desktop, «Salvar» e «Descartar» ficam no cabeçalho, sempre à vista.
            <ShellSlot>
              <div className="clinic-bar-ctx">
                {profileDirty ? (
                  <span className="clinic-bar-pill clinic-bar-pill--warn" role="status">
                    Alterações por salvar
                  </span>
                ) : null}
                <span className="clinic-bar-action clinic-bar-action--row">
                  <Button
                    className="panel-btn panel-btn-ghost"
                    onPress={discardProfile}
                    isDisabled={profileBusy || !profileDirty}
                  >
                    Descartar
                  </Button>
                  <Button
                    className="panel-btn panel-btn-primary"
                    onPress={() => void saveProfile()}
                    isDisabled={profileBusy || !profileDirty}
                  >
                    {profileBusy ? 'Salvando…' : 'Salvar dados para a IA'}
                  </Button>
                </span>
              </div>
            </ShellSlot>
          ) : (
            <Button
              className="panel-btn panel-btn-secondary"
              onPress={() => void saveProfile()}
              isDisabled={profileBusy}
            >
              {profileBusy ? 'Salvando…' : 'Salvar dados para a IA'}
            </Button>
          )}
          {profileNote ? (
            <p className="clinic-footnote" role="status">
              {profileNote}
            </p>
          ) : null}
        </>
      ) : null}
      {error ? (
        <p className="clinic-footnote clinic-footnote-warn" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
