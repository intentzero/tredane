import { useState } from 'react'
import { Button, Input, Label, TextField, ToggleButton, ToggleButtonGroup } from 'react-aria-components'
import { PanelApiError, type PanelApi } from '../../api'

type Place = {
  mode?: 'nenhum' | 'cidade' | 'coordenadas'
  city?: string | null
  latitude?: number | null
  longitude?: number | null
}

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
  place: Place
  onSaved: () => void
}

function formatCoord(value: number | null | undefined): string {
  return value == null ? '' : String(value)
}

function parseCoord(raw: string): number | null {
  const text = raw.trim().replace(',', '.')
  if (!text) return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

/**
 * Local da previsão no hub (DEC-077). Visível com a IA ligada ou desligada.
 * Não grava o endereço livre do cartão de sugestões.
 */
export function ForecastPlaceCard({ tenantId, api, generation, place, onSaved }: Props) {
  const [mode, setMode] = useState<'cidade' | 'coordenadas'>(
    place.mode === 'coordenadas' ? 'coordenadas' : 'cidade',
  )
  const [city, setCity] = useState(place.city ?? '')
  const [latitude, setLatitude] = useState(formatCoord(place.latitude))
  const [longitude, setLongitude] = useState(formatCoord(place.longitude))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  async function save() {
    setError(null)
    setNote(null)
    if (mode === 'cidade') {
      if (!city.trim()) {
        setError('Informe a cidade.')
        return
      }
      if (city.trim().length > 80) {
        setError('A cidade pode ter até 80 caracteres.')
        return
      }
    } else {
      const lat = parseCoord(latitude)
      const lon = parseCoord(longitude)
      if (lat == null || lat < -90 || lat > 90) {
        setError('Latitude tem de estar entre −90 e 90.')
        return
      }
      if (lon == null || lon < -180 || lon > 180) {
        setError('Longitude tem de estar entre −180 e 180.')
        return
      }
    }
    setBusy(true)
    try {
      const saved =
        mode === 'cidade'
          ? await api.setForecastPlace(
              tenantId,
              { mode: 'cidade', city: city.trim() },
              { generation, expectGeneration: () => generation },
            )
          : await api.setForecastPlace(
              tenantId,
              {
                mode: 'coordenadas',
                latitude: parseCoord(latitude)!,
                longitude: parseCoord(longitude)!,
              },
              { generation, expectGeneration: () => generation },
            )
      setCity(saved.forecastCity ?? '')
      setLatitude(formatCoord(saved.forecastLatitude))
      setLongitude(formatCoord(saved.forecastLongitude))
      setNote(saved.forecastMode === 'cidade' ? 'Cidade salva.' : 'Coordenadas salvas.')
      onSaved()
    } catch (err) {
      if (err instanceof PanelApiError && err.status === 400) {
        setError('Não foi possível salvar este local.')
      } else {
        setError('Não foi possível salvar. Tente de novo.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel-card" aria-labelledby="forecast-place-t">
      <h2 id="forecast-place-t" className="panel-title-md">
        Local para a previsão
      </h2>
      <p className="panel-muted-sm">
        Serve para saber o tempo na hora do compromisso. Não é o endereço que a IA usa.
      </p>
      <ToggleButtonGroup
        className="panel-segmented"
        aria-label="Tipo de local"
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[mode]}
        onSelectionChange={(keys) => {
          const next = [...keys][0]
          if (next === 'cidade' || next === 'coordenadas') setMode(next)
        }}
      >
        <ToggleButton id="cidade" className="panel-segmented-item">
          Cidade
        </ToggleButton>
        <ToggleButton id="coordenadas" className="panel-segmented-item">
          Coordenadas
        </ToggleButton>
      </ToggleButtonGroup>
      {mode === 'cidade' ? (
        <TextField className="clinic-field" value={city} onChange={setCity}>
          <Label>Cidade</Label>
          <Input placeholder="Campinas" maxLength={80} />
        </TextField>
      ) : (
        <>
          <TextField className="clinic-field" value={latitude} onChange={setLatitude}>
            <Label>Latitude</Label>
            <Input inputMode="decimal" placeholder="−22,9" />
          </TextField>
          <TextField className="clinic-field" value={longitude} onChange={setLongitude}>
            <Label>Longitude</Label>
            <Input inputMode="decimal" placeholder="−47,06" />
          </TextField>
        </>
      )}
      <Button className="panel-btn panel-btn-secondary" onPress={() => void save()} isDisabled={busy}>
        {busy ? 'Salvando…' : 'Salvar local'}
      </Button>
      {note ? (
        <p className="clinic-footnote" role="status">
          {note}
        </p>
      ) : null}
      {error ? (
        <p className="clinic-footnote clinic-footnote-warn" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
