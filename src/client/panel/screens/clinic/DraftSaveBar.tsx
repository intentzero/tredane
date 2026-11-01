import { Button } from 'react-aria-components'

type Props = {
  count: number
  /** Frase curta do efeito noutras fichas (DEC-105). */
  effect?: string | null
  saving?: boolean
  onDiscard: () => void
  onSave: () => void
  saveLabel?: string
}

/** Barra fixa «N alterações · Descartar · Salvar» (DEC-105; padrão do horário da clínica). */
export function DraftSaveBar({
  count,
  effect,
  saving,
  onDiscard,
  onSave,
  saveLabel = 'Salvar',
}: Props) {
  if (count <= 0) return null
  const label = count === 1 ? '1 alteração' : `${count} alterações`
  return (
    <div className="hours-savebar" role="region" aria-label="Alterações por salvar">
      <p>
        <strong>{label}</strong>
        {effect ? ` · ${effect}` : null}
      </p>
      <div className="clinic-footer-actions">
        <Button className="panel-btn panel-btn-ghost" isDisabled={saving} onPress={onDiscard}>
          Descartar
        </Button>
        <Button className="panel-btn panel-btn-primary" isDisabled={saving} onPress={onSave}>
          {saving ? 'Salvando…' : saveLabel}
        </Button>
      </div>
    </div>
  )
}
