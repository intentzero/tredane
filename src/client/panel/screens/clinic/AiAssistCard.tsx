import { useState } from 'react'
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
  initialAddress?: string | null
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
  initialAddress = null,
  initialGoogleBusinessUrl = null,
  initialReschedulePolicy = null,
  initialVirtualAttendantName = null,
  initialVirtualAttendantGender = null,
}: Props) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [address, setAddress] = useState(initialAddress ?? '')
  const [gbUrl, setGbUrl] = useState(initialGoogleBusinessUrl ?? '')
  const [gbError, setGbError] = useState<string | null>(null)
  const [policy, setPolicy] = useState(initialReschedulePolicy ?? '')
  const [virtualName, setVirtualName] = useState(initialVirtualAttendantName ?? '')
  const [virtualGender, setVirtualGender] = useState<VirtualGender>(
    initialVirtualAttendantGender ?? '',
  )
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileNote, setProfileNote] = useState<string | null>(null)

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
          clinicAddress: address.trim(),
          googleBusinessUrl: gb.value,
          reschedulePolicy: policy.trim(),
          virtualAttendantName: virtualName.trim(),
          virtualAttendantGender: virtualGender,
        },
        { generation, expectGeneration: () => generation },
      )
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

  async function toggle(next: boolean) {
    setBusy(true)
    setError(null)
    try {
      const s = await api.setClinicAiAssist(tenantId, next, {
        generation,
        expectGeneration: () => generation,
      })
      setEnabled(s.aiAssistEnabled === true)
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
            A IA prepara um rascunho a cada mensagem da cliente; a equipe sempre revisa antes de
            enviar. A IA só marca um horário depois de a cliente confirmar tocando no botão do
            WhatsApp, e apenas quando essa opção estiver ligada. Alterações e cancelamentos ficam
            com a equipe. As mensagens não ficam guardadas pelo provedor de IA nem são usadas para treinar modelos.
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="panel-checkbox"
          checked={enabled}
          disabled={busy}
          aria-checked={enabled}
          onChange={(e) => void toggle(e.target.checked)}
          aria-label="Ativar sugestões de resposta com IA"
        />
      </label>
      {enabled ? (
        <>
          <TextField className="clinic-field">
            <Label>Endereço da clínica (para a IA)</Label>
            <TextArea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} />
          </TextField>
          <TextField
            className="clinic-field"
            isInvalid={gbError != null}
            value={gbUrl}
            onChange={(v) => {
              setGbUrl(v)
              if (gbError) setGbError(null)
            }}
          >
            <Label>Link do Google Business (opcional)</Label>
            <Input
              type="url"
              inputMode="url"
              placeholder="https://maps.app.goo.gl/…"
              maxLength={GOOGLE_BUSINESS_URL_MAX_LENGTH}
            />
            <Text slot="description" className="panel-muted-sm">
              A IA envia este link quando a cliente pedir a localização ou como chegar.
            </Text>
            {gbError ? (
              <p className="clinic-footnote clinic-footnote-warn" role="alert">
                {gbError}
              </p>
            ) : null}
          </TextField>
          <TextField className="clinic-field">
            <Label>Regras de remarcação e cancelamento</Label>
            <TextArea value={policy} onChange={(e) => setPolicy(e.target.value)} rows={3} />
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
            className="clinic-field"
            value={virtualGender || 'nenhum'}
            onChange={(v) =>
              setVirtualGender(v === 'masculino' || v === 'feminino' ? v : '')
            }
            aria-label="Género do atendente virtual"
          >
            <Label>Género do atendente virtual</Label>
            <Radio value="nenhum" className="panel-radio">
              Neutro
            </Radio>
            <Radio value="feminino" className="panel-radio">
              Feminino
            </Radio>
            <Radio value="masculino" className="panel-radio">
              Masculino
            </Radio>
            <Text slot="description" className="panel-muted-sm">
              Só a responsável altera.
            </Text>
          </RadioGroup>
          <Button
            className="panel-btn panel-btn-secondary"
            onPress={() => void saveProfile()}
            isDisabled={profileBusy}
          >
            {profileBusy ? 'Salvando…' : 'Salvar dados para a IA'}
          </Button>
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
