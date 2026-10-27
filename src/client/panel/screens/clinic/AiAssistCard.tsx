import { useState } from 'react'
import { Button, Label, TextArea, TextField } from 'react-aria-components'
import type { PanelApi } from '../../api'

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
  initialEnabled: boolean
  initialAddress?: string | null
  initialReschedulePolicy?: string | null
}

/**
 * Opt-in de IA por clínica (política de privacidade §6). Default desligado.
 * O servidor recusa qualquer sugestão/resumo enquanto estiver desligado.
 */
export function AiAssistCard({
  tenantId,
  api,
  generation,
  initialEnabled,
  initialAddress = null,
  initialReschedulePolicy = null,
}: Props) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [address, setAddress] = useState(initialAddress ?? '')
  const [policy, setPolicy] = useState(initialReschedulePolicy ?? '')
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileNote, setProfileNote] = useState<string | null>(null)

  async function saveProfile() {
    setProfileBusy(true)
    setProfileNote(null)
    try {
      await api.setClinicAiProfile(
        tenantId,
        { clinicAddress: address.trim(), reschedulePolicy: policy.trim() },
        { generation, expectGeneration: () => generation },
      )
      setProfileNote('Salvo. A IA passa a usar estes dados nos rascunhos.')
    } catch {
      setProfileNote('Não foi possível salvar. Tente de novo.')
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
            enviar. A IA nunca envia nem marca horários. As mensagens
            não ficam guardadas pelo provedor de IA nem são usadas para treinar modelos.
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
          <TextField className="clinic-field">
            <Label>Regras de remarcação e cancelamento</Label>
            <TextArea value={policy} onChange={(e) => setPolicy(e.target.value)} rows={3} />
          </TextField>
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
