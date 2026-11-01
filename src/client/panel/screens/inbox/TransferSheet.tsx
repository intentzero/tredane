import { useEffect, useState } from 'react'
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import type { PanelApi, TeamMemberLite } from '../../api'
import { friendlyError } from '../../copy/errors'

type Props = {
  open: boolean
  tenantId: string
  api: PanelApi
  generation: number
  /** Quem está logado: nunca aparece na lista. */
  viewerClerkUserId: string
  /** Responsável atual (marcado como «já atende»). */
  currentAssigneeClerkUserId: string | null
  busy: boolean
  onClose: () => void
  onPick: (member: { clerkUserId: string; displayName: string }) => void
}

function roleName(role: string): string {
  return role === 'owner' ? 'Responsável' : 'Atendente'
}

/** Transferir a conversa para outro membro ativo da clínica ativa (TEL-02). */
export function TransferSheet(p: Props) {
  const [members, setMembers] = useState<TeamMemberLite[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!p.open) return
    let cancelled = false
    setMembers(null)
    setError(null)
    p.api
      .getTeamMembers(p.tenantId, { generation: p.generation, expectGeneration: () => p.generation })
      .then((res) => {
        if (!cancelled) setMembers(res.members)
      })
      .catch((err) => {
        if (!cancelled) setError(friendlyError(err, 'Não foi possível carregar a equipe.'))
      })
    return () => {
      cancelled = true
    }
  }, [p.open, p.api, p.tenantId, p.generation])

  const options = (members ?? []).filter(
    (m) => m.status === 'active' && m.clerkUserId !== p.viewerClerkUserId,
  )
  // Preferir nome (DEC-102); sem nome, «Atendente 2» quando há mais de um do mesmo papel.
  const counters = new Map<string, number>()
  const labelled = options.map((m) => {
    const named = m.displayName?.trim()
    if (named) return { ...m, label: named }
    const total = options.filter((o) => o.role === m.role && !o.displayName?.trim()).length
    const n = (counters.get(m.role) ?? 0) + 1
    counters.set(m.role, n)
    return { ...m, label: total > 1 ? `${roleName(m.role)} ${n}` : roleName(m.role) }
  })

  return (
    <ModalOverlay
      isOpen={p.open}
      onOpenChange={(next) => {
        if (!next && !p.busy) p.onClose()
      }}
      className="panel-overlay"
      style={{ position: 'fixed', inset: 0, zIndex: 30 }}
      isDismissable={!p.busy}
    >
      <Modal>
        <Dialog
          className="panel-sheet"
          style={{ position: 'fixed', left: 0, right: 0, bottom: 0 }}
          aria-labelledby="transfer-title"
        >
          <span className="panel-sheet-handle" aria-hidden="true" />
          <Heading slot="title" id="transfer-title" className="thread-actions-title">
            Transferir para
          </Heading>
          {error ? (
            <p className="inbox-notice" role="alert">
              {error}
            </p>
          ) : members === null ? (
            <p className="panel-subtitle">Carregando equipe…</p>
          ) : labelled.length === 0 ? (
            <p className="panel-subtitle">Não há outra pessoa ativa nesta clínica.</p>
          ) : (
            labelled.map((m) => (
              <Button
                key={m.clerkUserId}
                className="thread-actions-item"
                isDisabled={p.busy}
                onPress={() => p.onPick({ clerkUserId: m.clerkUserId, displayName: m.label })}
              >
                {m.label}
                {m.clerkUserId === p.currentAssigneeClerkUserId ? (
                  <span className="thread-actions-hint"> · já atende</span>
                ) : null}
              </Button>
            ))
          )}
          <Button className="panel-btn-secondary thread-actions-cancel" isDisabled={p.busy} onPress={p.onClose}>
            Cancelar
          </Button>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
