import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Button } from 'react-aria-components'
import type { ClinicConfigReview, PanelApi } from '../../api'
import { navigatePanel } from '../../routes'
import { Banner } from '../../states/Banner'
import { ErrorState } from '../../states/StatusScreens'
import { ClinicSkeleton } from './ClinicSkeleton'
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
 * DEC-112: aviso informativo de percurso sem saída na conversa (não bloqueia a IA).
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

  if (loading && !review) return <ClinicSkeleton shape="table" label="Carregando Conferir" />
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
      {review.services.length > 0 ? (
        // DEC-174: tabela no desktop, linhas no celular; a linha inteira abre a ficha.
        <div className="conferir-table">
          <div className="conferir-table-head" aria-hidden="true">
            <span>Serviço</span>
            <span>Quem faz</span>
            <span>Onde</span>
            <span>Próximo horário</span>
          </div>
          <ul className="conferir-rows">
            {review.services.map((s) => (
              <li key={s.serviceId} className="conferir-item" data-ready={s.ready ? 'true' : 'false'}>
                <Button
                  className="conferir-row"
                  aria-label={`Abrir ficha de ${s.serviceName}`}
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
                  <strong className="conferir-cell conferir-name">{s.serviceName}</strong>
                  <span className="conferir-cell" data-label="Quem faz">
                    {s.who.length > 0 ? s.who.join(', ') : 'Ninguém'}
                  </span>
                  <span className="conferir-cell" data-label="Onde" data-muted={s.whereLabel === 'Sem espaço definido' ? 'true' : undefined}>
                    {s.whereLabel}
                  </span>
                  {s.ready && s.nextSlotStartsAt != null ? (
                    <span className="conferir-cell" data-label="Próximo horário">
                      {formatNext(s.nextSlotStartsAt, review.timezone)}
                    </span>
                  ) : (
                    <span className="conferir-cell conferir-reason" data-label="Motivo">
                      {s.blockReason ?? 'Incompleto'}
                    </span>
                  )}
                  <ChevronRight className="conferir-chevron" aria-hidden size={18} />
                </Button>
                {(s.conversationPathFindings?.length ?? 0) > 0 ? (
                  <div
                    className="conferir-conversation-lint"
                    data-conversation-lint="true"
                    role="status"
                  >
                    <strong>Este serviço não consegue ser marcado pela conversa</strong>
                    <ul>
                      {(s.conversationPathFindings ?? []).map((f) => (
                        <li key={f.code}>{f.message}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
