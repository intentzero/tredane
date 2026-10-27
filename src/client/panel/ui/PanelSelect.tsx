import { Check, ChevronDown } from 'lucide-react'
import { useId, useState } from 'react'
import { Dialog, Heading, ListBox, ListBoxItem, Modal, ModalOverlay } from 'react-aria-components'

export type PanelSelectOption<K extends string = string> = {
  id: K
  label: string
  /** Texto secundário curto (ex.: «cadastre o preço»). */
  hint?: string
  disabled?: boolean
}

/** Até este número de opções a folha abre na altura do conteúdo (Tiririca: ≤8). */
export const PANEL_SELECT_COMPACT_MAX = 8

/**
 * Campo de escolha único do painel (backlog item 2 / Tiririca 5).
 *
 * - Gatilho com o visual de `panel-select-trigger` (16px, alvo ≥44px).
 * - A lista abre como folha inferior — sem teclado, sem o picker nativo do iOS.
 *   Até 8 opções a folha ajusta-se ao conteúdo; acima disso fica alta e rola,
 *   com a opção atual visível.
 * - Opções 16px com alvos de 44px+ (o iOS faz zoom abaixo de 16px).
 */
export function PanelSelect<K extends string = string>({
  label,
  options,
  value,
  onChange,
  placeholder = 'Escolha uma opção',
  isDisabled,
  className,
  hideLabel,
}: {
  label: string
  options: ReadonlyArray<PanelSelectOption<K>>
  value: K | null
  onChange: (id: K) => void
  placeholder?: string
  isDisabled?: boolean
  className?: string
  /** Rótulo só para leitores de ecrã (o contexto já é visível). */
  hideLabel?: boolean
}) {
  const [open, setOpen] = useState(false)
  const labelId = useId()
  const valueId = useId()
  const current = options.find((o) => o.id === value) ?? null
  const compact = options.length <= PANEL_SELECT_COMPACT_MAX
  const disabledKeys = options.filter((o) => o.disabled).map((o) => o.id)
  return (
    <div className={['panel-choice', className ?? 'panel-field'].join(' ')}>
      <span id={labelId} className={hideLabel ? 'panel-sr-only' : 'panel-choice-label'}>
        {label}
      </span>
      <button
        type="button"
        className="panel-select-trigger panel-choice-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={`${labelId} ${valueId}`}
        disabled={isDisabled}
        onClick={() => setOpen(true)}
      >
        <span id={valueId} className="panel-choice-value" data-placeholder={current ? undefined : true}>
          {current ? current.label : placeholder}
        </span>
        <ChevronDown aria-hidden size={18} strokeWidth={2} />
      </button>
      <ModalOverlay
        isOpen={open}
        onOpenChange={setOpen}
        isDismissable
        className="panel-overlay panel-choice-overlay"
      >
        <Modal className="panel-choice-modal">
          <Dialog
            className="panel-sheet panel-choice-sheet"
            data-size={compact ? 'compact' : 'tall'}
            aria-labelledby={`${labelId}-title`}
          >
            <span className="panel-sheet-handle" aria-hidden="true" />
            <Heading slot="title" id={`${labelId}-title`} className="panel-title panel-choice-title">
              {label}
            </Heading>
            <ListBox
              aria-labelledby={`${labelId}-title`}
              className="panel-choice-list"
              selectionMode="single"
              disallowEmptySelection={false}
              selectedKeys={value ? [value] : []}
              disabledKeys={disabledKeys}
              autoFocus={current ? undefined : 'first'}
              onSelectionChange={(keys) => {
                if (keys === 'all') return
                const next = [...keys][0]
                if (next != null) onChange(String(next) as K)
                setOpen(false)
              }}
            >
              {options.map((o) => (
                <ListBoxItem
                  key={o.id}
                  id={o.id}
                  className="panel-choice-item"
                  textValue={o.label}
                  ref={(el: HTMLDivElement | null) => {
                    if (el && o.id === value && !compact) el.scrollIntoView({ block: 'center' })
                  }}
                >
                  {({ isSelected }) => (
                    <>
                      <span className="panel-choice-item-text">
                        {o.label}
                        {o.hint ? <span className="panel-choice-hint">{o.hint}</span> : null}
                      </span>
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
