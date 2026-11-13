/**
 * Campo opcional de sinônimos / nomes populares (DEC-110 / M-16).
 * Só interpretação; a cliente nunca vê estes textos.
 */
import { useState } from 'react'
import { Button, Input, Label, TextField } from 'react-aria-components'
import { X } from 'lucide-react'

type Props = {
  label?: string
  value: string[]
  onChange: (next: string[]) => void
  /** Ajuda curta sob o campo. */
  hint?: string
  /** Limite alinhado ao backend (SYNONYM_MAX_COUNT). */
  maxCount?: number
  /** Exemplo mostrado quando a lista está vazia. */
  placeholder?: string
  /**
   * DEC-176 — onde mais a palavra já está («Massagem › Relaxante»), ou null.
   * O servidor recusa a mesma palavra em dois sítios; aqui avisa-se antes.
   */
  takenBy?: (word: string) => string | null
}

const DEFAULT_MAX = 8

/** Chip + input para nomes populares na ficha do serviço/variante. */
export function SynonymsField({
  label = 'Sinônimos',
  value,
  onChange,
  hint = 'Nomes que a cliente usa. Só ajudam a entender o pedido; as respostas usam o nome do catálogo.',
  maxCount = DEFAULT_MAX,
  placeholder = 'Adicionar…',
  takenBy,
}: Props) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  function add(raw: string) {
    const text = raw.trim()
    if (!text) return
    if (text.length < 2 || text.length > 40) {
      setError('Cada palavra tem entre 2 e 40 caracteres.')
      return
    }
    const key = text.toLocaleLowerCase('pt-BR')
    if (value.some((v) => v.toLocaleLowerCase('pt-BR') === key)) {
      setError('Esta palavra já está na lista.')
      return
    }
    const owner = takenBy?.(text)
    if (owner) {
      setError(`«${text}» já está em ${owner}. Deixe a palavra num sítio só.`)
      return
    }
    if (value.length >= maxCount) {
      setError(`No máximo ${maxCount} palavras.`)
      return
    }
    setError(null)
    onChange([...value, text])
    setDraft('')
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index))
  }

  return (
    <div className="synonyms-field">
      <TextField className="clinic-field">
        <Label>{label}</Label>
        <div className="synonyms-chips" role="list" aria-label={label}>
          {value.map((syn, index) => (
            <span key={`${syn}-${index}`} className="synonyms-chip" role="listitem">
              <span>{syn}</span>
              <Button
                className="synonyms-chip-remove"
                aria-label={`Remover ${syn}`}
                onPress={() => remove(index)}
              >
                <X aria-hidden size={14} />
              </Button>
            </span>
          ))}
          <Input
            className="synonyms-input"
            value={draft}
            autoComplete="off"
            placeholder={value.length === 0 ? placeholder : 'Adicionar…'}
            aria-label={`Adicionar ${label.toLocaleLowerCase('pt-BR')}`}
            onChange={(e) => {
              setDraft(e.target.value)
              if (error) setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                add(draft)
              } else if (e.key === 'Backspace' && !draft && value.length > 0) {
                remove(value.length - 1)
              }
            }}
            onBlur={() => {
              if (draft.trim()) add(draft)
            }}
          />
        </div>
      </TextField>
      {error ? (
        <p className="clinic-field-error" role="alert">
          {error}
        </p>
      ) : (
        <p className="clinic-footnote">{hint}</p>
      )}
    </div>
  )
}
