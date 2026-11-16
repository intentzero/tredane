import { useEffect, useState } from 'react'
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { adminErrorMessage, type SampleDetail, type SampleItem } from '../api'
import { REVIEW_DIRECTION_LABEL, SAMPLE_SOURCE_LABEL, formatReading } from '../format'
import { useAdminApi } from '../useAdminApi'

type Props = { sample: SampleItem | null; onClose: () => void }

/**
 * Conversa de uma amostra de revisão (DEC-193): texto real de uma cliente, só para o superadmin.
 * Abrir regista a leitura na auditoria; o telefone vem mascarado.
 */
export function SampleDialog({ sample, onClose }: Props) {
  const api = useAdminApi()
  const [detail, setDetail] = useState<SampleDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!sample) return
    let alive = true
    setDetail(null)
    setError(null)
    api
      .getSample(sample.id)
      .then((d) => {
        if (alive) setDetail(d)
      })
      .catch((err) => {
        if (alive) setError(adminErrorMessage(err))
      })
    return () => {
      alive = false
    }
  }, [api, sample])

  if (!sample) return null
  const who = [sample.contactDisplayName, sample.contactPhoneMasked].filter(Boolean).join(' · ') || 'Cliente'

  return (
    <ModalOverlay isOpen onOpenChange={(next) => !next && onClose()} isDismissable className="admin-overlay">
      <Modal className="admin-modal">
        <Dialog className="admin-dialog admin-dialog--wide" aria-labelledby="admin-sample-title">
          <Heading slot="title" id="admin-sample-title" className="admin-dialog-title">
            Amostra · {sample.tenantName ?? sample.tenantId}
          </Heading>
          <p className="admin-muted">
            {who} · {SAMPLE_SOURCE_LABEL[sample.flagSource] ?? sample.flagSource}
            {sample.flagReason ? ` · ${sample.flagReason}` : ''} · marcada em {formatReading(sample.flaggedAt)}
          </p>
          <div className="admin-note admin-note--warn" role="note">
            <span>
              Texto de conversa real. Só o superadmin vê, a amostra expira ao fim de 30 dias e esta leitura fica
              registada na auditoria.
            </span>
          </div>
          {(detail ?? sample).clientComments.length > 0 ? (
            <section aria-label="Comentários da cliente" className="admin-sample-comments">
              <strong>O que a cliente escreveu sobre o problema</strong>
              <ul>
                {(detail ?? sample).clientComments.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {error ? <p className="admin-dialog-error" role="alert">{error}</p> : null}
          {!detail && !error ? <p className="admin-muted" role="status">Carregando a conversa…</p> : null}
          {detail ? (
            <ol className="admin-thread" aria-label="Mensagens">
              {detail.messages.map((m) => (
                <li key={m.id} className={`admin-msg admin-msg--${m.direction}`}>
                  <span className="admin-msg-meta">
                    {REVIEW_DIRECTION_LABEL[m.direction] ?? m.direction}
                    {m.authorDisplayName ? ` · ${m.authorDisplayName}` : ''} · {formatReading(m.createdAt)}
                  </span>
                  <span className="admin-msg-body">{m.body}</span>
                </li>
              ))}
            </ol>
          ) : null}
          <div className="admin-dialog-actions">
            <button type="button" className="admin-btn" onClick={onClose}>
              Fechar
            </button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
