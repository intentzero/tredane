/**
 * STAGING-ONLY: um botão que chama POST .../whatsapp/dev/sync-existing-binding.
 * O servidor responde 404 fora de staging (ENVIRONMENT + WHATSAPP_DEV_SYNC_ENABLED).
 */
import { useState } from 'react'
import { Button } from 'react-aria-components'
import type { PanelApi } from '../../../api'

type Props = { tenantId: string; api: PanelApi; generation: number }

function describe(status: number, body: unknown): string {
  const b = (body ?? {}) as Record<string, unknown>
  if (status === 200 && b.ok === true) {
    return `Pronto: WhatsApp marcado como ${String(b.status)} (número ${String(b.displayPhone)}). Já pode fazer o envio de teste.`
  }
  if (status === 404 && b.error === 'not_found') return 'Indisponível neste ambiente (só staging).'
  if (b.error === 'token_key_mismatch') {
    return 'A credencial guardada não decifra com a chave deste servidor. Nada foi alterado.'
  }
  if (b.error === 'no_active_binding') return 'Não há vínculo WhatsApp activo para esta clínica.'
  if (status === 401) return 'Sessão expirada — entre de novo.'
  if (status === 403) return 'Só o dono da clínica pode fazer isto.'
  return `Falhou (HTTP ${status}).`
}

export function WhatsappDevSyncScreen({ tenantId, api, generation }: Props) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ status: number; body: unknown } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    try {
      setResult(
        await api.devSyncExistingWhatsappBinding(tenantId, {
          generation,
          expectGeneration: () => generation,
        }),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="clinic-stack whatsapp-stack">
      <section className="clinic-banner" aria-labelledby="wa-devsync-title">
        <h2 id="wa-devsync-title">Staging: ligar WhatsApp de teste</h2>
        <p>
          Marca o número de teste já registado como conectado nesta clínica, para
          permitir o envio de teste. Só funciona em staging, para o dono da clínica.
        </p>
      </section>
      <Button className="panel-btn-primary" isDisabled={busy} onPress={() => void run()}>
        {busy ? 'A sincronizar…' : 'Marcar WhatsApp de teste como conectado'}
      </Button>
      {error ? <p role="alert">{error}</p> : null}
      {result ? (
        <div role="status">
          <p>{describe(result.status, result.body)}</p>
          <pre style={{ whiteSpace: 'pre-wrap' }}>
            {`HTTP ${result.status}\n${JSON.stringify(result.body, null, 2)}`}
          </pre>
        </div>
      ) : null}
    </div>
  )
}
