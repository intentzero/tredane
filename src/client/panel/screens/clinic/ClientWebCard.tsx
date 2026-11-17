import { useEffect, useState } from 'react'
import { ClinicSkeletonLines } from './ClinicSkeleton'
import { PanelApiError, type ClientWebSettingDto, type PanelApi } from '../../api'
import { friendlyError } from '../../copy/errors'

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
}

/**
 * Página de agendamento por link (DEC-196, DEC-199) — só a responsável (DEC-042).
 * Desligada por defeito. Ligada, a abertura do atendimento no WhatsApp leva o botão «Abrir agenda».
 */
export function ClientWebCard({ tenantId, api, generation }: Props) {
  const [view, setView] = useState<ClientWebSettingDto | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const next = await api.getClientWebSetting(tenantId, { generation, expectGeneration: () => generation })
        if (cancelled) return
        setView(next)
        setEnabled(next.enabled)
      } catch (err) {
        if (cancelled) return
        // 403 (não é a responsável) ou API sem esta rota: o cartão não aparece.
        if (err instanceof PanelApiError && err.status !== 403 && err.message !== 'stale_tenant_response') {
          setError(friendlyError(err, 'Não foi possível carregar esta configuração.'))
        } else {
          setView(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [tenantId, generation, api])

  async function save(next: boolean) {
    setBusy(true)
    setNote(null)
    setError(null)
    try {
      const saved = await api.setClientWebEnabled(tenantId, next, { generation, expectGeneration: () => generation })
      setView((v) => (v ? { ...v, ...saved } : saved))
      setEnabled(saved.enabled)
      setNote(saved.enabled ? 'Página de agendamento ligada.' : 'Página de agendamento desligada.')
    } catch (err) {
      if (err instanceof PanelApiError && err.message === 'stale_tenant_response') return
      setEnabled(!next)
      setError(friendlyError(err, 'Não foi possível salvar. Tente de novo.'))
    } finally {
      setBusy(false)
    }
  }

  if (loading && !view) {
    return (
      <section className="panel-card" aria-labelledby="client-web-t">
        <h2 id="client-web-t" className="panel-title-md">
          Agendamento por link
        </h2>
        <ClinicSkeletonLines label="Carregando agendamento por link" lines={2} />
      </section>
    )
  }
  if (!view && !error) return null

  return (
    <section className="panel-card" aria-labelledby="client-web-t">
      <h2 id="client-web-t" className="panel-title-md">
        Agendamento por link
      </h2>
      <p className="panel-muted-sm">
        A cliente recebe no WhatsApp um botão «Abrir agenda» e agenda, remarca ou cancela numa página, sem
        escrever. O link é pessoal e vale por pouco tempo. As dúvidas continuam a ser respondidas na conversa.
      </p>
      <label className="panel-switch-row">
        <span>
          <span className="panel-switch-label">Oferecer o agendamento por link</span>
          <span className="panel-muted-sm">
            Desligado por defeito. Desligar fecha na hora as páginas abertas; os horários já marcados ficam como estão.
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="panel-switch"
          checked={enabled}
          disabled={busy || view?.available === false}
          aria-checked={enabled}
          onChange={(e) => {
            const next = e.target.checked
            setEnabled(next)
            void save(next)
          }}
          aria-label="Oferecer o agendamento por link"
        />
      </label>
      {view?.available === false ? (
        <p className="clinic-footnote" role="note">
          Esta função ainda não está disponível neste ambiente.
        </p>
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
