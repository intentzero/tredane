import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components'
import { PanelSelect } from '../../ui/PanelSelect'
import type { ResourceFutureAppointment } from '../../api'

/** Valor da escolha «manter» por compromisso (não remaneja). */
export const KEEP = '__keep__'

export type FutureChoice = Record<string, string>

export function defaultChoices(appointments: ResourceFutureAppointment[]): FutureChoice {
  const out: FutureChoice = {}
  for (const a of appointments) out[a.appointmentId] = a.suggestedResourceId ?? KEEP
  return out
}

export function formatAppointmentWhen(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(ms)
}

type FutureProps = {
  open: boolean
  resourceName: string
  kind: 'professional' | 'room'
  timeZone: string
  appointments: ResourceFutureAppointment[]
  choices: FutureChoice
  busy: boolean
  error: string | null
  onChange: (next: FutureChoice) => void
  onClose: () => void
  onConfirm: () => void
}

/**
 * Desativar com compromissos futuros: por compromisso, remanejar para outro
 * recurso livre e compatível ou manter (só bloqueia novos agendamentos).
 * Nada é cancelado e o paciente não é avisado automaticamente.
 */
export function FutureAppointmentsDialog({
  open,
  resourceName,
  kind,
  timeZone,
  appointments,
  choices,
  busy,
  error,
  onChange,
  onClose,
  onConfirm,
}: FutureProps) {
  const target = kind === 'professional' ? 'profissional' : 'sala'
  const anySuggestion = appointments.some((a) => a.suggestedResourceId)
  const reassignCount = appointments.filter((a) => choices[a.appointmentId] !== KEEP).length
  return (
    <ModalOverlay
      isOpen={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
      className="panel-overlay"
      style={{ position: 'fixed', inset: 0, zIndex: 30 }}
      isDismissable={!busy}
    >
      <Modal>
        <Dialog
          className="panel-sheet"
          style={{ position: 'fixed', left: 0, right: 0, bottom: 0, maxHeight: '88dvh', overflowY: 'auto' }}
          aria-labelledby="future-apts-title"
        >
          <span className="panel-sheet-handle" aria-hidden="true" />
          <Heading slot="title" id="future-apts-title" className="panel-title" style={{ margin: '8px 0 2px' }}>
            Desativar {resourceName}?
          </Heading>
          <p className="panel-subtitle" style={{ margin: '0 0 12px' }}>
            {appointments.length === 1
              ? 'Há 1 compromisso futuro.'
              : `Há ${appointments.length} compromissos futuros.`}{' '}
            Escolha o que fazer com cada um. Nada é cancelado e o paciente não é avisado
            automaticamente.
          </p>
          <div className="clinic-footer-actions" style={{ marginBottom: 12 }}>
            <Button
              className="panel-btn panel-btn-ghost"
              isDisabled={busy || !anySuggestion}
              onPress={() => {
                const next: FutureChoice = {}
                for (const a of appointments) next[a.appointmentId] = a.suggestedResourceId ?? KEEP
                onChange(next)
              }}
            >
              Remanejar todos (sugestão)
            </Button>
            <Button
              className="panel-btn panel-btn-ghost"
              isDisabled={busy}
              onPress={() => {
                const next: FutureChoice = {}
                for (const a of appointments) next[a.appointmentId] = KEEP
                onChange(next)
              }}
            >
              Manter todos
            </Button>
          </div>
          <ul className="clinic-nav-list" aria-label="Compromissos futuros">
            {appointments.map((a) => (
              <li key={a.appointmentId} className="clinic-nav-row clinic-nav-row-static" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <span className="clinic-nav-copy">
                  <strong>{formatAppointmentWhen(a.startsAt, timeZone)}</strong>
                  <span>
                    {a.serviceName ?? 'Serviço'}
                    {a.contactLabel ? ` · ${a.contactLabel}` : ''}
                  </span>
                </span>
                <PanelSelect
                  className="clinic-field"
                  label={`Destino do compromisso de ${formatAppointmentWhen(a.startsAt, timeZone)}`}
                  hideLabel
                  value={choices[a.appointmentId] ?? KEEP}
                  isDisabled={busy}
                  onChange={(v) => onChange({ ...choices, [a.appointmentId]: v })}
                  options={[
                    ...a.candidates.map((c) => ({
                      id: c.id,
                      label: `Remanejar para ${c.name}`,
                      hint: c.id === a.suggestedResourceId ? 'sugestão · livre neste horário' : 'livre neste horário',
                    })),
                    {
                      id: KEEP,
                      label: 'Manter neste horário',
                      hint:
                        a.candidates.length === 0
                          ? `nenhuma outra ${target} livre e compatível`
                          : 'só deixa de receber novos agendamentos',
                    },
                  ]}
                />
              </li>
            ))}
          </ul>
          {error ? (
            <p className="clinic-form-error" role="alert">
              {error}
            </p>
          ) : null}
          <Button className="panel-btn-secondary" autoFocus isDisabled={busy} onPress={onClose}>
            Cancelar
          </Button>
          <Button
            className="panel-btn panel-btn-primary"
            style={{ marginTop: 8, width: '100%' }}
            isDisabled={busy}
            onPress={onConfirm}
          >
            {busy
              ? 'Desativando…'
              : reassignCount > 0
                ? `Remanejar ${reassignCount} e desativar`
                : 'Desativar só para novos agendamentos'}
          </Button>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}

type DeleteProps = {
  open: boolean
  resourceName: string
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}

export function DeleteResourceDialog({ open, resourceName, busy, error, onClose, onConfirm }: DeleteProps) {
  return (
    <ModalOverlay
      isOpen={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
      className="panel-overlay"
      style={{ position: 'fixed', inset: 0, zIndex: 30 }}
      isDismissable={!busy}
    >
      <Modal>
        <Dialog
          className="panel-sheet"
          style={{ position: 'fixed', left: 0, right: 0, bottom: 0 }}
          role="alertdialog"
          aria-labelledby="delete-resource-title"
          aria-describedby="delete-resource-desc"
        >
          <span className="panel-sheet-handle" aria-hidden="true" />
          <Heading slot="title" id="delete-resource-title" className="panel-title" style={{ margin: '8px 0 2px' }}>
            Excluir {resourceName}?
          </Heading>
          <p id="delete-resource-desc" className="panel-subtitle" style={{ margin: '0 0 12px' }}>
            Nunca teve compromissos, por isso pode ser excluído. Expediente e bloqueios
            também são removidos. Esta ação não pode ser desfeita.
          </p>
          {error ? (
            <p className="clinic-form-error" role="alert">
              {error}
            </p>
          ) : null}
          <Button className="panel-btn-secondary" autoFocus isDisabled={busy} onPress={onClose}>
            Cancelar
          </Button>
          <Button className="panel-btn-danger" style={{ marginTop: 8 }} isDisabled={busy} onPress={onConfirm}>
            {busy ? 'Excluindo…' : 'Excluir permanentemente'}
          </Button>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}

type DeleteServiceProps = {
  open: boolean
  serviceName: string
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}

export function DeleteServiceDialog({ open, serviceName, busy, error, onClose, onConfirm }: DeleteServiceProps) {
  return (
    <ModalOverlay
      isOpen={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
      className="panel-overlay"
      style={{ position: 'fixed', inset: 0, zIndex: 30 }}
      isDismissable={!busy}
    >
      <Modal>
        <Dialog
          className="panel-sheet"
          style={{ position: 'fixed', left: 0, right: 0, bottom: 0 }}
          role="alertdialog"
          aria-labelledby="delete-service-title"
          aria-describedby="delete-service-desc"
        >
          <span className="panel-sheet-handle" aria-hidden="true" />
          <Heading slot="title" id="delete-service-title" className="panel-title" style={{ margin: '8px 0 2px' }}>
            Apagar {serviceName}?
          </Heading>
          <p id="delete-service-desc" className="panel-subtitle" style={{ margin: '0 0 12px' }}>
            Nunca teve marcações, por isso pode ser apagado. Os vínculos com profissionais e
            salas também são removidos. Esta ação não pode ser desfeita.
          </p>
          {error ? (
            <p className="clinic-form-error" role="alert">
              {error}
            </p>
          ) : null}
          <Button className="panel-btn-secondary" autoFocus isDisabled={busy} onPress={onClose}>
            Cancelar
          </Button>
          <Button className="panel-btn-danger" style={{ marginTop: 8 }} isDisabled={busy} onPress={onConfirm}>
            {busy ? 'Apagando…' : 'Apagar permanentemente'}
          </Button>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
