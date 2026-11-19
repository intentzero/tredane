import { useEffect, useState } from 'react'
import { Button } from 'react-aria-components'
import { PanelApiError, type PanelApi } from '../../api'
import { friendlyError } from '../../copy/errors'

/**
 * DEC-202/DEC-212: «Pausar a agenda online». Corta o link «Abrir agenda» e o marcar, remarcar e
 * cancelar na página da cliente; os pedidos passam à equipe. Não cancela horários já marcados.
 * É uma ação de emergência: fica no topo do Assistente, não atrás das proteções.
 */
export function OnlineAgendaCard({
  tenantId,
  api,
  generation,
}: {
  tenantId: string
  api: PanelApi
  generation: number
}) {
  const [paused, setPaused] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void api
      .getClinicAbuseLimits(tenantId, { generation, expectGeneration: () => generation })
      .then((v) => {
        if (!cancelled) setPaused(v.autoBookPaused === true)
      })
      .catch((err) => {
        if (cancelled || (err instanceof PanelApiError && err.message === 'stale_tenant_response')) return
        setError(friendlyError(err, 'Não foi possível carregar o estado da agenda.'))
      })
    return () => {
      cancelled = true
    }
  }, [tenantId, generation, api])

  async function toggle() {
    if (paused === null) return
    const next = !paused
    setBusy(true)
    setError(null)
    try {
      const v = await api.patchClinicAbuseLimits(
        tenantId,
        { autoBookPaused: next },
        { generation, expectGeneration: () => generation },
      )
      setPaused(v.autoBookPaused === true)
    } catch (err) {
      if (err instanceof PanelApiError && err.message === 'stale_tenant_response') return
      setError(friendlyError(err, 'Não foi possível salvar. Tente de novo.'))
    } finally {
      setBusy(false)
    }
  }

  if (paused === null && !error) return null

  return (
    <section className="panel-card" aria-labelledby="online-agenda-t">
      <div className="panel-switch-row">
        <span>
          <h2 id="online-agenda-t" className="panel-title-md">
            Agenda online: {paused ? 'pausada' : 'aberta'}
          </h2>
          <span className="panel-muted-sm">
            {paused
              ? 'Os pedidos de marcar vão para a equipe. A cliente só vê as marcações dela.'
              : 'A cliente marca, remarca e cancela pelo link. Pause se precisar parar tudo agora; não cancela horários já marcados.'}
          </span>
        </span>
        {paused !== null ? (
          <Button className="panel-btn panel-btn-secondary" isDisabled={busy} onPress={() => void toggle()}>
            {paused ? 'Retomar' : 'Pausar'}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p className="clinic-footnote clinic-footnote-warn" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
