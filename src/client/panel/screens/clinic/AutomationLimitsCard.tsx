import { useEffect, useState } from 'react'
import { Button, Input, Label, TextField } from 'react-aria-components'
import { PanelApiError, type AbuseLimitsDto, type PanelApi } from '../../api'
import { friendlyError } from '../../copy/errors'

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
}

type LimitField = {
  key: keyof AbuseLimitsDto['limits']
  label: string
  hint: string
}

const FIELDS: LimitField[] = [
  {
    key: 'windowHours',
    label: 'Janela (horas)',
    hint: 'Período rolante em que as quotas contam.',
  },
  {
    key: 'autoDraftsPerContact',
    label: 'Rascunhos automáticos por contato',
    hint: 'Sugestões geradas sozinhas na janela.',
  },
  {
    key: 'aiBookingsPerContact',
    label: 'Marcações automáticas por contato',
    hint: 'Confirmações por botão do WhatsApp na janela.',
  },
  {
    key: 'aiBookingsPerClinic',
    label: 'Marcações automáticas na clínica',
    hint: 'Total da clínica na janela.',
  },
  {
    key: 'futureAppointmentsPerContact',
    label: 'Compromissos futuros por contato',
    hint: 'Antes de nova marcação automática.',
  },
  {
    key: 'pendingPixPerContact',
    label: 'Pix pendentes por contato',
    hint: 'Cobranças aguardando pagamento.',
  },
  {
    key: 'pendingProposalsPerContact',
    label: 'Propostas pendentes por contato',
    hint: 'Uma proposta aberta de cada vez, em geral.',
  },
  {
    key: 'proposalsPerContact',
    label: 'Propostas criadas por contato',
    hint: 'Na janela.',
  },
  {
    key: 'proposalsPerClinic',
    label: 'Propostas criadas na clínica',
    hint: 'Total da clínica na janela.',
  },
]

/**
 * Limites de proteção das automações — só a responsável (DEC-042).
 * Pausar não cancela horários já marcados nem bloqueia a equipe no painel.
 */
export function AutomationLimitsCard({ tenantId, api, generation }: Props) {
  const [view, setView] = useState<AbuseLimitsDto | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [autoBookPaused, setAutoBookPaused] = useState(false)
  const [limits, setLimits] = useState<AbuseLimitsDto['limits'] | null>(null)
  const [showNumbers, setShowNumbers] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const next = await api.getClinicAbuseLimits(tenantId, {
        generation,
        expectGeneration: () => generation,
      })
      if (!next?.limits || !next.caps || !next.platformCeilings) {
        setError('Não foi possível carregar os limites.')
        setView(null)
        return
      }
      setView(next)
      setEnabled(next.enabled)
      setAutoBookPaused(next.autoBookPaused)
      setLimits({ ...next.limits })
    } catch (err) {
      if (err instanceof PanelApiError && err.status === 403) {
        setError(null)
        setView(null)
      } else if (err instanceof PanelApiError && err.message === 'stale_tenant_response') {
        return
      } else {
        setError(friendlyError(err, 'Não foi possível carregar os limites.'))
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [tenantId, generation, api])

  async function save(patch: {
    enabled?: boolean
    autoBookPaused?: boolean
    limits?: Partial<AbuseLimitsDto['limits']>
    resetToDefaults?: boolean
  }) {
    setBusy(true)
    setNote(null)
    setError(null)
    try {
      const next = await api.patchClinicAbuseLimits(
        tenantId,
        {
          enabled: patch.enabled,
          autoBookPaused: patch.autoBookPaused,
          resetToDefaults: patch.resetToDefaults,
          ...(patch.limits ?? {}),
        },
        { generation, expectGeneration: () => generation },
      )
      setView(next)
      setEnabled(next.enabled)
      setAutoBookPaused(next.autoBookPaused)
      setLimits({ ...next.limits })
      setNote(
        patch.resetToDefaults
          ? 'Números restaurados aos padrões confirmados.'
          : 'Limites salvos.',
      )
    } catch (err) {
      if (err instanceof PanelApiError && err.message === 'stale_tenant_response') return
      setError(friendlyError(err, 'Não foi possível salvar. Tente de novo.'))
    } finally {
      setBusy(false)
    }
  }

  if (loading && !view) {
    return (
      <section className="panel-card" aria-labelledby="abuse-limits-t">
        <h2 id="abuse-limits-t" className="panel-title-md">
          Limites das automações
        </h2>
        <p className="panel-muted-sm">Carregando…</p>
      </section>
    )
  }

  if (!view || !limits || !view.caps || !view.platformCeilings) {
    return null
  }

  const ceiling = (key: keyof AbuseLimitsDto['limits']) =>
    Math.min(view.caps[key] ?? 1, view.platformCeilings[key] ?? 1)

  return (
    <section className="panel-card" aria-labelledby="abuse-limits-t">
      <h2 id="abuse-limits-t" className="panel-title-md">
        Limites das automações
      </h2>
      <p className="panel-muted-sm">
        Protege a clínica contra inundações de rascunhos, propostas e marcações feitas pela IA.
        Não cancela horários já marcados e não impede ações manuais da equipe. A plataforma pode
        impor um teto máximo. Pausar novas marcações automáticas vale só para esta clínica.
      </p>

      <label className="panel-switch-row">
        <span>
          <span className="panel-switch-label">Aplicar limites de proteção</span>
          <span className="panel-muted-sm">
            Quando desligado, as quotas desta clínica não bloqueiam efeitos automáticos (fail-closed
            até ligar).
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="panel-checkbox"
          checked={enabled}
          disabled={busy}
          aria-checked={enabled}
          onChange={(e) => {
            const next = e.target.checked
            setEnabled(next)
            void save({ enabled: next })
          }}
          aria-label="Aplicar limites de proteção"
        />
      </label>

      <label className="panel-switch-row">
        <span>
          <span className="panel-switch-label">Pausar novas marcações automáticas por botão</span>
          <span className="panel-muted-sm">
            Impede novas propostas e confirmações pelo botão do WhatsApp nesta clínica. Não cancela
            compromissos já marcados.
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="panel-checkbox"
          checked={autoBookPaused}
          disabled={busy}
          aria-checked={autoBookPaused}
          onChange={(e) => {
            const next = e.target.checked
            setAutoBookPaused(next)
            void save({ autoBookPaused: next })
          }}
          aria-label="Pausar novas marcações automáticas por botão"
        />
      </label>

      <Button
        className="panel-btn-ghost"
        aria-expanded={showNumbers}
        aria-controls="abuse-numbers"
        onPress={() => setShowNumbers((v) => !v)}
      >
        {showNumbers ? 'Ocultar os números' : `Personalizar os ${FIELDS.length} limites`}
      </Button>

      {showNumbers ? (
        <div id="abuse-numbers">
      <div className="clinic-stack" style={{ gap: 12, marginTop: 12 }}>
        {FIELDS.map((f) => (
          <TextField key={f.key} className="clinic-field">
            <Label>{f.label}</Label>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={ceiling(f.key)}
              value={String(limits[f.key])}
              disabled={busy}
              onChange={(e) => {
                const n = Number(e.target.value)
                setLimits((prev) => (prev ? { ...prev, [f.key]: n } : prev))
              }}
              aria-describedby={`abuse-hint-${f.key}`}
            />
            <p id={`abuse-hint-${f.key}`} className="panel-muted-sm">
              {f.hint} Máximo: {ceiling(f.key)}.
            </p>
          </TextField>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        <Button
          className="panel-btn panel-btn-secondary"
          isDisabled={busy}
          onPress={() => void save({ limits: limits ?? undefined })}
        >
          {busy ? 'Salvando…' : 'Salvar números'}
        </Button>
        <Button
          className="panel-btn panel-btn-secondary"
          isDisabled={busy}
          onPress={() => void save({ resetToDefaults: true })}
        >
          Restaurar padrões
        </Button>
      </div>

        </div>
      ) : null}

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
