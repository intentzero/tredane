import { Check, ChevronDown } from 'lucide-react'
import { useId, useState } from 'react'
import { Dialog, Heading, ListBox, ListBoxItem, Modal, ModalOverlay } from 'react-aria-components'

export type HoldSelectOption = { id: string; label: string }

/**
 * Campo de escolha do painel para folhas no celular: o gatilho tem o visual de
 * `panel-select-trigger` e a lista abre como folha inferior (alvos de 44px+,
 * fonte 16px — evita o zoom do iOS), sem teclado.
 */
export function HoldSelect({
  label,
  placeholder,
  options,
  value,
  onChange,
  isDisabled,
}: {
  label: string
  placeholder: string
  options: HoldSelectOption[]
  value: string | null
  onChange: (id: string) => void
  isDisabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const labelId = useId()
  const current = options.find((o) => o.id === value) ?? null
  return (
    <div className="panel-field hold-select">
      <span id={labelId}>{label}</span>
      <button
        type="button"
        className="panel-select-trigger hold-select-trigger"
        aria-haspopup="dialog"
        aria-labelledby={labelId}
        aria-describedby={`${labelId}-v`}
        disabled={isDisabled}
        onClick={() => setOpen(true)}
      >
        <span id={`${labelId}-v`} className="hold-select-value" data-placeholder={current ? undefined : true}>
          {current ? current.label : placeholder}
        </span>
        <ChevronDown aria-hidden size={18} strokeWidth={2} />
      </button>
      <ModalOverlay
        isOpen={open}
        onOpenChange={setOpen}
        isDismissable
        className="panel-overlay"
        style={{ position: 'fixed', inset: 0, zIndex: 50 }}
      >
        <Modal>
          <Dialog className="panel-sheet hold-select-sheet" style={{ position: 'fixed', left: 0, right: 0, bottom: 0 }} aria-label={label}>
            <span className="panel-sheet-handle" aria-hidden="true" />
            <Heading slot="title" className="panel-title hold-select-title">
              {label}
            </Heading>
            <ListBox
              aria-label={label}
              className="hold-select-list"
              selectionMode="single"
              selectedKeys={value ? [value] : []}
              autoFocus={current ? undefined : 'first'}
              onSelectionChange={(keys) => {
                const next = [...keys][0]
                if (next != null) onChange(String(next))
                setOpen(false)
              }}
            >
              {options.map((o) => (
                <ListBoxItem key={o.id} id={o.id} className="hold-select-item" textValue={o.label}>
                  {({ isSelected }) => (
                    <>
                      <span>{o.label}</span>
                      {isSelected ? <Check aria-hidden size={18} strokeWidth={2.4} /> : null}
                    </>
                  )}
                </ListBoxItem>
              ))}
            </ListBox>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </div>
  )
}
