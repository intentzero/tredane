import { Check, ChevronDown } from 'lucide-react'
import { useId, useState } from 'react'
import { Button, Dialog, Heading, ListBox, ListBoxItem, Modal, ModalOverlay } from 'react-aria-components'

export type PanelMultiOption = {
  id: string
  label: string
  /** Texto secundário curto (ex.: «Horário próprio»). */
  hint?: string
  /** Cor do ponto ao lado do nome (pessoas na semana e nas folgas). */
  color?: string
}

/**
 * Campo de escolha múltipla do painel, irmão de `PanelSelect`: o gatilho mostra as escolhas em
 * chips e a lista abre em folha inferior com caixas de marcar e «Concluir». A regra de quais
 * combinações valem (ex.: «Clínica inteira» exclusiva) fica com quem usa, em `onChange`.
 */
export function PanelMultiSelect({
  label,
  options,
  value,
  onChange,
  placeholder = 'Escolha',
  className,
}: {
  label: string
  options: ReadonlyArray<PanelMultiOption>
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const labelId = useId()
  const valueId = useId()
  const chosen = options.filter((o) => value.includes(o.id))
  return (
    <div className={['panel-choice', className ?? 'panel-field'].join(' ')}>
      <span id={labelId} className="panel-choice-label">
        {label}
      </span>
      <button
        type="button"
        className="panel-select-trigger panel-choice-trigger panel-multi-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={`${labelId} ${valueId}`}
        onClick={() => setOpen(true)}
      >
        <span id={valueId} className="panel-multi-chips" data-placeholder={chosen.length === 0 ? true : undefined}>
          {chosen.length === 0
            ? placeholder
            : chosen.map((o) => (
                <span key={o.id} className="panel-multi-chip">
                  {o.color ? <i className="panel-multi-dot" style={{ background: o.color }} aria-hidden /> : null}
                  {o.label}
                </span>
              ))}
        </span>
        <ChevronDown aria-hidden size={18} strokeWidth={2} />
      </button>
      <ModalOverlay isOpen={open} onOpenChange={setOpen} isDismissable className="panel-overlay panel-choice-overlay">
        <Modal className="panel-choice-modal">
          <Dialog className="panel-sheet panel-choice-sheet" data-size="tall" aria-labelledby={`${labelId}-title`}>
            <span className="panel-sheet-handle" aria-hidden="true" />
            <Heading slot="title" id={`${labelId}-title`} className="panel-title panel-choice-title">
              {label}
            </Heading>
            <ListBox
              aria-labelledby={`${labelId}-title`}
              className="panel-choice-list"
              selectionMode="multiple"
              selectedKeys={value}
              onSelectionChange={(keys) => {
                if (keys === 'all') return
                // Mantém a ordem das opções, não a ordem dos cliques.
                const next = new Set([...keys].map(String))
                onChange(options.filter((o) => next.has(o.id)).map((o) => o.id))
              }}
            >
              {options.map((o) => (
                <ListBoxItem key={o.id} id={o.id} className="panel-choice-item" textValue={o.label}>
                  {({ isSelected }) => (
                    <>
                      <span className="panel-multi-box" aria-hidden>
                        {isSelected ? <Check size={14} strokeWidth={3} /> : null}
                      </span>
                      {o.color ? <i className="panel-multi-dot" style={{ background: o.color }} aria-hidden /> : null}
                      <span className="panel-choice-item-text">
                        {o.label}
                        {o.hint ? <span className="panel-choice-hint">{o.hint}</span> : null}
                      </span>
                    </>
                  )}
                </ListBoxItem>
              ))}
            </ListBox>
            <div className="panel-multi-foot">
              <span>{value.length === 1 ? '1 selecionada' : `${value.length} selecionadas`}</span>
              <Button className="panel-btn panel-btn-primary" onPress={() => setOpen(false)}>
                Concluir
              </Button>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </div>
  )
}
