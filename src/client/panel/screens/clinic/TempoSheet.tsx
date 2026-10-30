import { Input, Label, NumberField, Radio, RadioGroup } from 'react-aria-components'
import { ClinicSheet } from './ClinicSheet'

export type TempoDraft = {
  ceu: 'tanto_faz' | 'sol' | 'chuva'
  temperatura: 'tanto_faz' | 'acima' | 'abaixo'
  celsius: number | null
}

type Props = {
  open: boolean
  value: TempoDraft
  onChange: (next: TempoDraft) => void
  onOpenChange: (open: boolean) => void
}

/** Folha Tempo do serviço (M-53 / DEC-084; regras DEC-077). */
export function TempoSheet({ open, value, onChange, onOpenChange }: Props) {
  return (
    <ClinicSheet isOpen={open} onOpenChange={onOpenChange} title="Tempo">
      <div className="clinic-stack">
        {value.ceu === 'tanto_faz' && value.temperatura === 'tanto_faz' ? (
          <p className="clinic-footnote">Sem restrição de tempo.</p>
        ) : null}
        <RadioGroup
          className="clinic-fieldset"
          aria-label="Céu"
          value={value.ceu}
          onChange={(next) => {
            if (next === 'tanto_faz' || next === 'sol' || next === 'chuva') {
              onChange({ ...value, ceu: next })
            }
          }}
        >
          <span className="clinic-section-title">Céu</span>
          <Radio className="clinic-check" value="tanto_faz">
            Tanto faz
          </Radio>
          <Radio className="clinic-check" value="sol">
            Sol
          </Radio>
          <Radio className="clinic-check" value="chuva">
            Chuva
          </Radio>
        </RadioGroup>
        {value.ceu === 'sol' ? (
          <p className="clinic-footnote">
            Na hora marcada: céu limpo, pouco nublado ou parcialmente nublado, sem chuva.
          </p>
        ) : null}
        {value.ceu === 'chuva' ? (
          <p className="clinic-footnote">
            Na hora marcada tem de estar chovendo (chuva, garoa ou trovoada).
          </p>
        ) : null}
        <RadioGroup
          className="clinic-fieldset"
          aria-label="Temperatura"
          value={value.temperatura}
          onChange={(next) => {
            if (next === 'tanto_faz' || next === 'acima' || next === 'abaixo') {
              onChange({
                ...value,
                temperatura: next,
                celsius: next === 'tanto_faz' ? null : value.celsius,
              })
            }
          }}
        >
          <span className="clinic-section-title">Temperatura</span>
          <Radio className="clinic-check" value="tanto_faz">
            Tanto faz
          </Radio>
          <Radio className="clinic-check" value="acima">
            Acima de
          </Radio>
          <Radio className="clinic-check" value="abaixo">
            Abaixo de
          </Radio>
        </RadioGroup>
        {value.temperatura !== 'tanto_faz' ? (
          <NumberField
            className="clinic-field"
            aria-label="Graus (°C)"
            value={value.celsius ?? Number.NaN}
            onChange={(n) => onChange({ ...value, celsius: Number.isNaN(n) ? null : n })}
            step={1}
          >
            <Label>Graus (°C)</Label>
            <Input />
          </NumberField>
        ) : null}
      </div>
    </ClinicSheet>
  )
}

export function tempoSummary(t: TempoDraft): string {
  if (t.ceu === 'tanto_faz' && t.temperatura === 'tanto_faz') return 'Sem restrição'
  const parts: string[] = []
  if (t.ceu === 'sol') parts.push('Sol')
  if (t.ceu === 'chuva') parts.push('Chuva')
  if (t.temperatura === 'acima' && t.celsius != null) parts.push(`Acima de ${t.celsius} °C`)
  else if (t.temperatura === 'abaixo' && t.celsius != null) parts.push(`Abaixo de ${t.celsius} °C`)
  else if (t.temperatura === 'acima') parts.push('Acima de…')
  else if (t.temperatura === 'abaixo') parts.push('Abaixo de…')
  return parts.join(' · ') || 'Sem restrição'
}
