/**
 * STAGING-ONLY (dono): «Repor clínica ao estado inicial».
 * Chama POST .../staging/reset-operational-data. O servidor recusa (404) fora de
 * ENVIRONMENT=staging, 403 para não-donos — o cliente só esconde fora de staging.*.
 */
import { useState } from 'react'
import { Button } from 'react-aria-components'
import type { PanelApi } from '../../api'
import { friendlyError } from '../../copy/errors'
import { StagingDestructiveConfirmDialog } from './StagingDestructiveConfirmDialog'

export function describeResetResult(status: number, body: unknown): string {
  const b = (body ?? {}) as Record<string, unknown>
  if (status === 200 && b.ok === true) {
    return `Pronto: ${String(b.totalDeleted)} registros operacionais apagados. Configuração, salas, equipe e WhatsApp foram mantidos.`
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

export function StagingResetCard({ tenantId, api, generation, onDone }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function onConfirm() {
    setBusy(true)
    setMessage(null)
    try {
      const r = await api.resetClinicOperationalData(tenantId, {
        generation,
        expectGeneration: () => generation,
      })
      setMessage(describeResetResult(r.status, r.body))
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
      <section aria-labelledby="staging-reset" className="whatsapp-dev-sync-section">
        <h3 id="staging-reset" className="whatsapp-subhead">
          Staging: repor clínica ao estado inicial
        </h3>
        <p className="clinic-footnote">
          Apaga conversas, contatos, pipeline, agendamentos, cobranças Pix de teste e filas da IA
          desta clínica. Mantém a conta, a equipe, serviços, salas, horários e o WhatsApp. Não dá
          para desfazer.
        </p>
        <Button className="panel-btn-secondary" onPress={() => setDialogOpen(true)}>
          Apagar dados operacionais
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
        title="Repor clínica ao estado inicial?"
        confirmLabel="Confirmar"
        confirmBusyLabel="Apagando…"
        onClose={() => setDialogOpen(false)}
        onConfirm={() => void onConfirm()}
        description={
          <>
            <p style={{ margin: '0 0 8px' }}>Será apagado desta clínica (só staging):</p>
            <ul style={{ margin: '0 0 8px', paddingLeft: '1.25rem' }}>
              <li>Contatos e conversas (mensagens, anexos, eventos)</li>
              <li>Pipeline (oportunidades e histórico de etapas)</li>
              <li>Compromissos, holds, propostas e sessões de agendamento</li>
              <li>Cobranças Pix de teste e alertas associados</li>
              <li>Sugestões, comandos e filas da assistência por IA</li>
              <li>Mensagens pendentes e outbox operacional</li>
            </ul>
            <p style={{ margin: 0 }}>
              Mantém serviços, profissionais, salas, horários e bloqueios, conta Pix, canal e
              modelos WhatsApp, FAQ/conhecimento da clínica e demais configuração. Não dá para
              desfazer.
            </p>
          </>
        }
      />
    </>
  )
}