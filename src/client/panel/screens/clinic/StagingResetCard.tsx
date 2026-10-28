/**
 * STAGING-ONLY (dono): «Repor clínica ao estado inicial».
 * Chama POST .../staging/reset-operational-data. O servidor recusa (404) fora de
 * ENVIRONMENT=staging, 403 para não-donos e 400 se o nome não bate — o cliente só esconde.
 */
import { useState } from 'react'
import { Button, Input, Label, TextField } from 'react-aria-components'
import type { PanelApi } from '../../api'
import { friendlyError } from '../../copy/errors'

export function describeResetResult(status: number, body: unknown): string {
  const b = (body ?? {}) as Record<string, unknown>
  if (status === 200 && b.ok === true) {
    return `Pronto: ${String(b.totalDeleted)} registros operacionais apagados. Configuração, salas, equipe e WhatsApp foram mantidos.`
  }
  if (status === 404) return 'Indisponível neste ambiente (só staging).'
  if (status === 403) return 'Só o dono da clínica pode fazer isto.'
  if (status === 400) return 'O nome não confere. Escreva o nome exato da clínica.'
  if (status === 401) return 'Sessão expirada — entre de novo.'
  return `Falhou (HTTP ${status}).`
}

type Props = {
  tenantId: string
  clinicName: string
  api: PanelApi
  generation: number
  onDone?: () => void
}

export function StagingResetCard({ tenantId, clinicName, api, generation, onDone }: Props) {
  const [confirmName, setConfirmName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const matches = confirmName.trim() !== '' && confirmName.trim() === clinicName.trim()

  async function onPress() {
    setBusy(true)
    setMessage(null)
    try {
      const r = await api.resetClinicOperationalData(tenantId, confirmName, {
        generation,
        expectGeneration: () => generation,
      })
      setMessage(describeResetResult(r.status, r.body))
      if (r.status === 200) {
        setConfirmName('')
        onDone?.()
      }
    } catch (err) {
      setMessage(friendlyError(err, 'Não deu para concluir agora. Tente de novo.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="staging-reset" className="whatsapp-dev-sync-section">
      <h3 id="staging-reset" className="whatsapp-subhead">
        Staging: repor clínica ao estado inicial
      </h3>
      <p className="clinic-footnote">
        Apaga conversas, mensagens, contatos, agendamentos, cobranças Pix de teste e sugestões
        da IA desta clínica. Mantém a conta, a equipe, a configuração, as salas e o WhatsApp.
        Não dá para desfazer.
      </p>
      <TextField className="clinic-field">
        <Label>Digite o nome da clínica para confirmar</Label>
        <Input
          autoComplete="off"
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          aria-label="Nome da clínica"
        />
      </TextField>
      <Button
        className="panel-btn-secondary"
        isDisabled={busy || !matches}
        onPress={() => void onPress()}
      >
        {busy ? 'Apagando…' : 'Apagar dados operacionais'}
      </Button>
      {message ? (
        <p className="clinic-footnote" role="status">
          {message}
        </p>
      ) : null}
    </section>
  )
}
