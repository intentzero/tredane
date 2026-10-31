import { useEffect, useState } from 'react'
import { Button } from 'react-aria-components'
import type { ClinicConfigReview, PanelApi } from '../../api'
import { navigatePanel } from '../../routes'
import { Banner } from '../../states/Banner'
import { ErrorState, LoadingState } from '../../states/StatusScreens'
import { friendlyError } from '../../copy/errors'

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
}

function formatNext(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(ms)
}

/**
 * Conferir configuração (M-52 / DEC-085): só leitura, serviço a serviço.
 * Motivo e próximo horário vêm do servidor.
 */
export function ConferirScreen({ tenantId, api, generation }: Props) {
  const [review, setReview] = useState<ClinicConfigReview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void api
      .getClinicConfigReview(tenantId, {
        generation,
        expectGeneration: () => generation,
      })
      .then((body) => {
        if (!cancelled) setReview(body)
      })
      .catch((err) => {
        if (!cancelled) setError(friendlyError(err, 'Não foi possível conferir a configuração.'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [api, tenantId, generation])

  const goHub = () =>
    navigatePanel({ kind: 'area', area: 'clinica', tenantId, section: 'hub' })

  if (loading && !review) return <LoadingState label="A conferir serviços…" />
  if (error && !review) {
    return (
      <ErrorState
        title="Não foi possível conferir"
        description={error}
        actionLabel="Voltar ao início"
        onAction={goHub}
      />
    )
  }
  if (!review) return null

  const blocked = review.services.filter((s) => !s.ready).length
  const ready = review.services.length - blocked

  return (
    <div className="clinic-stack">
      <header className="clinic-page-head">
        <Button className="panel-icon-btn" aria-label="Voltar" onPress={goHub}>
          ‹
        </Button>
        <div className="clinic-page-head-copy">
          <h1 className="panel-title">Conferir configuração</h1>
          <span className="panel-subtitle">Só leitura · início da Clínica</span>
        </div>
      </header>
      {review.services.length === 0 ? (
        <Banner tone="warn" title="Nenhum serviço ativo">
          <p>Cadastre um serviço para conferir quem faz, onde e quando.</p>
        </Banner>
      ) : (
        <div
          className="conferir-summary"
          data-tone={blocked === 0 ? 'ok' : 'warn'}
          role="status"
        >
          <strong>
            {blocked === 0
              ? 'Todos os serviços prontos'
              : blocked === 1
                ? '1 serviço incompleto'
                : `${blocked} serviços incompletos`}
          </strong>
          <span>
            {ready} prontos · {blocked} a corrigir
          </span>
        </div>
      )}
      <ul className="clinic-stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 12 }}>
        {review.services.map((s) => (
          <li key={s.serviceId} className="conferir-card" data-ready={s.ready ? 'true' : 'false'}>
            <strong>{s.serviceName}</strong>
            <span className="clinic-footnote">
              Quem faz: {s.who.length > 0 ? s.who.join(', ') : 'ninguém'}
            </span>
            <span className="clinic-footnote">Onde: {s.whereLabel}</span>
            {s.ready && s.nextSlotStartsAt != null ? (
              <span className="clinic-footnote">
                Quando: próximo horário {formatNext(s.nextSlotStartsAt, review.timezone)}
              </span>
            ) : (
              <span className="clinic-footnote" role="status">
                Motivo: {s.blockReason ?? 'Incompleto'}
              </span>
            )}
            <Button
              className="panel-link conferir-open"
              onPress={() =>
                navigatePanel({
                  kind: 'area',
                  area: 'clinica',
                  tenantId,
                  section: s.fix.section,
                  entityId: s.fix.entityId,
                })
              }
            >
              Abrir ficha
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
