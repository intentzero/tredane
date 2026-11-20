/**
 * STAGING-ONLY (dono): «Limpar agenda».
 * Chama POST .../staging/clear-appointments. O servidor recusa (404) fora de
 * ENVIRONMENT=staging, 403 para não-donos — o cliente só esconde fora de staging.*.
 */
import { useState } from 'react'
import { Button } from 'react-aria-components'
import type { PanelApi } from '../../api'
import { friendlyError } from '../../copy/errors'
import { StagingDestructiveConfirmDialog } from './StagingDestructiveConfirmDialog'

export function describeClearAppointmentsResult(status: number, body: unknown): string {
  const b = (body ?? {}) as Record<string, unknown>
  if (status === 200 && b.ok === true) {
    const counts = (b.deletedCounts ?? {}) as Record<string, number>
    const appointments = Number(counts.appointments ?? 0)
    return `Pronto: ${appointments} compromisso(s) apagado(s) (${String(b.totalDeleted)} registros no total). Contatos, conversas e configuração foram mantidos.`
  }
  if (status === 404) return 'Indisponível neste ambiente (só staging).'
  if (status === 403) return 'Só o dono da clínica pode fazer isto.'
  if (status === 400) return 'Confirme a ação no diálogo antes de continuar.'
  if (status === 401) return 'Sessão expirada — entre de novo.'
  return `Falhou (HTTP ${status}).`
}

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
  onDone?: () => void
}

export function StagingClearAppointmentsCard({ tenantId, api, generation, onDone }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function onConfirm() {
    setBusy(true)
    setMessage(null)
    try {
      const r = await api.clearClinicAppointments(tenantId, {
        generation,
        expectGeneration: () => generation,
      })
      setMessage(describeClearAppointmentsResult(r.status, r.body))
      if (r.status === 200) {
        setDialogOpen(false)
        onDone?.()
      }
    } catch (err) {
      setMessage(friendlyError(err, 'Não deu para concluir agora. Tente de novo.'))
    } finally {
      setBusy(false)
    }
  }

  return (
  <>
    <section aria-labelledby="staging-clear-appointments" className="whatsapp-dev-sync-section">
      <h3 id="staging-clear-appointments" className="whatsapp-subhead">
        Staging: limpar agenda
      </h3>
      <p className="clinic-footnote">
        Remove todos os compromissos e reservas temporárias desta clínica para voltar a testar a
        agenda do zero. Contatos, conversas, serviços, salas, equipe e WhatsApp ficam intactos.
        Não dá para desfazer.
      </p>
      <Button className="panel-btn-secondary" onPress={() => setDialogOpen(true)}>
        Apagar todos os compromissos
      </Button>
      {message ? (
        <p className="clinic-footnote" role="status">
          {message}
        </p>
      ) : null}
    </section>
    <StagingDestructiveConfirmDialog
      open={dialogOpen}
      busy={busy}
      title="Limpar agenda?"
      confirmLabel="Confirmar"
      confirmBusyLabel="Apagando…"
      onClose={() => setDialogOpen(false)}
      onConfirm={() => void onConfirm()}
      description={
        <>
          <p style={{ margin: '0 0 8px' }}>Será apagado desta clínica (só staging):</p>
          <ul style={{ margin: '0 0 8px', paddingLeft: '1.25rem' }}>
            <li>Compromissos passados e futuros</li>
            <li>Alocações de sala e profissional nos horários</li>
            <li>Comandos e eventos internos dos compromissos</li>
            <li>Reservas temporárias (holds)</li>
            <li>Snapshots de zonas/combo ligados a visitas já marcadas</li>
          </ul>
          <p style={{ margin: 0 }}>
            Mantém contatos, conversas e mensagens, oportunidades no pipeline (desliga o vínculo com
            horário; Agendado que tinha marcação volta a Em atendimento), serviços, profissionais,
            salas, horários da clínica, Pix, WhatsApp e demais configuração. Não dá para desfazer.
          </p>
        </>
      }
    />
  </>
  )
}