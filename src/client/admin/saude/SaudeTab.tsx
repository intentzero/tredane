import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { adminErrorMessage, type AdminTenantStatus, type ChannelStatus, type ClinicHealth } from '../api'
import { AdminLoadError, AdminLoading, Pill } from '../AdminUi'
import {
  ALERT_LABEL,
  CHANNEL_LABEL,
  CHANNEL_TONE,
  SITUATION_LABEL,
  SITUATION_TONE,
  formatReading,
} from '../format'
import { useAdminApi } from '../useAdminApi'

type Load = { phase: 'loading' } | { phase: 'error' } | { phase: 'ready'; health: ClinicHealth }

const num = (v: number | null | undefined) => (v === null || v === undefined ? '—' : String(v))

function Card({ title, rows, foot }: { title: string; rows: Array<[string, ReactNode]>; foot?: string }) {
  return (
    <section className="admin-card" aria-label={title}>
      <h2 className="admin-card-title">{title}</h2>
      <div className="admin-rows">
        {rows.map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <span>{v}</span>
          </div>
        ))}
      </div>
      {foot ? <span className="admin-muted">{foot}</span> : null}
    </section>
  )
}

type Props = {
  tenantId: string
  tenantStatus: AdminTenantStatus
  whatsapp: { status: ChannelStatus; note: string }
}

/** Aba Saúde da clínica (PA-09): lê o resumo do cron; «Atualizar» relê o DO desta clínica agora (DEC-193). */
export function SaudeTab({ tenantId, tenantStatus, whatsapp }: Props) {
  const api = useAdminApi()
  const [load, setLoad] = useState<Load>({ phase: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoad((prev) => (prev.phase === 'ready' ? prev : { phase: 'loading' }))
    api
      .getTenantHealth(tenantId, { signal: controller.signal })
      .then((health) => {
        if (!controller.signal.aborted) setLoad({ phase: 'ready', health })
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoad((prev) => (prev.phase === 'ready' ? prev : { phase: 'error' }))
      })
    return () => controller.abort()
  }, [api, tenantId, attempt])

  const refresh = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      setLoad({ phase: 'ready', health: await api.refreshTenantHealth(tenantId) })
    } catch (err) {
      setError(adminErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }, [api, tenantId])

  if (load.phase === 'loading') return <AdminLoading label="Carregando a saúde…" />
  if (load.phase === 'error') return <AdminLoadError what="a saúde" onRetry={() => setAttempt((n) => n + 1)} />
  const { health } = load
  const n = health.counts
  const active = tenantStatus === 'active'

  return (
    <>
      <div className="admin-toolbar">
        <span className="admin-muted admin-toolbar-spacer">
          {health.readAt === null
            ? 'Esta clínica ainda não foi lida.'
            : `Leitura às ${formatReading(health.readAt)} · só contagens e estados, nenhuma mensagem é lida`}
        </span>
        <Pill tone={SITUATION_TONE[health.situation]}>{SITUATION_LABEL[health.situation]}</Pill>
        {active ? (
          <button type="button" className="admin-btn admin-btn--sm" disabled={busy} onClick={() => void refresh()}>
            {busy ? 'Atualizando…' : 'Atualizar'}
          </button>
        ) : null}
      </div>
      {!active ? (
        <div className="admin-note admin-note--warn" role="status">
          <span>
            {tenantStatus === 'suspended' ? 'Clínica suspensa' : 'Exclusão pendente'}: não há leituras novas. Os números
            são os da última leitura.
          </span>
        </div>
      ) : null}
      {health.stale ? (
        <div className="admin-note admin-note--warn" role="status">
          <span>
            {n
              ? 'A última leitura falhou: o Durable Object desta clínica não respondeu. Os números abaixo são da última leitura boa.'
              : 'O Durable Object desta clínica não respondeu: ainda não há nenhuma leitura boa.'}
          </span>
        </div>
      ) : null}
      {error ? <p className="admin-dialog-error" role="alert">{error}</p> : null}

      {health.alerts.length > 0 ? (
        <section className="admin-card" aria-labelledby="adm-alerts">
          <h2 id="adm-alerts" className="admin-card-title">Alertas desta clínica</h2>
          <div className="admin-table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Sinal</th>
                  <th scope="col" className="admin-num">Valor</th>
                  <th scope="col" className="admin-num">Limiar</th>
                </tr>
              </thead>
              <tbody>
                {health.alerts.map((a) => (
                  <tr key={a.kind}>
                    <th scope="row">{ALERT_LABEL[a.kind] ?? a.kind}</th>
                    <td className="admin-num"><Pill tone={a.severity === 'critical' ? 'bad' : 'warn'}>{num(a.value)}</Pill></td>
                    <td className="admin-num">{a.threshold !== null ? `≥ ${a.threshold}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <span className="admin-muted">Limiares propostos (src/ops/alerts.ts), ainda não são SLOs.</span>
        </section>
      ) : null}

      {n ? (
        <div className="admin-grid">
          <Card
            title="Envios"
            rows={[
              ['Outbox pendente', <b key="a">{num(n.pendingOutbox)}</b>],
              ['Outbox falhado', n.failedOutbox ? <Pill key="b" tone="bad">{num(n.failedOutbox)}</Pill> : <b key="b">{num(n.failedOutbox)}</b>],
              ['Estado incerto', n.uncertainOutbound ? <Pill key="c" tone="warn">{num(n.uncertainOutbound)}</Pill> : <b key="c">{num(n.uncertainOutbound)}</b>],
            ]}
          />
          <Card
            title="WhatsApp"
            rows={[['Estado', <Pill key="w" tone={CHANNEL_TONE[whatsapp.status]}>{CHANNEL_LABEL[whatsapp.status]}</Pill>]]}
            foot={`${whatsapp.note}. Sem número de telefone nesta tela.`}
          />
          <Card
            title="IA"
            rows={[
              ['Jobs na fila', <b key="a">{num(n.llmJobsOpen)}</b>],
              ['Falhados na última hora', n.llmJobsFailed1h ? <Pill key="b" tone="warn">{num(n.llmJobsFailed1h)}</Pill> : <b key="b">{num(n.llmJobsFailed1h)}</b>],
            ]}
          />
          <Card
            title="Dados"
            rows={[
              ['Versão do schema', <b key="a">{n.schemaVersion !== null ? `v${n.schemaVersion}` : '—'}</b>],
              ['Pronta', n.schemaReady === null ? '—' : <Pill key="b" tone={n.schemaReady ? 'ok' : 'bad'}>{n.schemaReady ? 'Sim' : 'Não'}</Pill>],
            ]}
          />
          <Card
            title="Volume"
            rows={[
              ['Contatos', <b key="a">{num(n.contactCount)}</b>],
              ['Mensagens', <b key="b">{num(n.messageCount)}</b>],
              ['Marcações', <b key="c">{num(n.appointmentCount)}</b>],
              ['Anexos', <b key="d">{num(n.attachmentCount)}</b>],
            ]}
            foot="Só números: nenhum conteúdo é lido."
          />
        </div>
      ) : (
        <section className="admin-card">
          <p className="admin-muted">Sem números ainda: a próxima leitura periódica ou «Atualizar» preenche esta aba.</p>
        </section>
      )}
    </>
  )
}
