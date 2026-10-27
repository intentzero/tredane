/**
 * STAGING-ONLY: acção partilhada «Marcar WhatsApp de teste como conectado».
 * Chama POST .../whatsapp/dev/sync-existing-binding (PanelApi.devSyncExistingWhatsappBinding).
 * O servidor responde 404 fora de staging e 403 para não-donos; o cliente só esconde.
 * Usada em WhatsappDevSyncScreen (/clinica/whatsapp/dev-sync) e no WhatsappScreen (main).
 */
import { useState } from 'react'
import { Button } from 'react-aria-components'
import type { PanelApi } from '../../../api'

export const DEV_SYNC_BUTTON_LABEL = 'Marcar WhatsApp de teste como conectado'

export type DevSyncResult = { status: number; body: unknown }

export function describeDevSyncResult(status: number, body: unknown): string {
  const b = (body ?? {}) as Record<string, unknown>
  if (status === 200 && b.ok === true) {
    return `Pronto: WhatsApp marcado como ${String(b.status)} (número ${String(b.displayPhone)}). Já pode fazer o envio de teste.`
  }
  if (status === 404 && b.error === 'not_found') return 'Indisponível neste ambiente (só staging).'
  if (b.error === 'token_key_mismatch') {
    return 'A credencial guardada não decifra com a chave deste servidor. Nada foi alterado.'
  }
  if (b.error === 'no_active_binding') return 'Não há vínculo WhatsApp ativo para esta clínica.'
  if (status === 401) return 'Sessão expirada — entre de novo.'
  if (status === 403) return 'Só o dono da clínica pode fazer isto.'
  return `Falhou (HTTP ${status}).`
}

export function isNotFoundResult(r: DevSyncResult | null): boolean {
  if (!r || r.status !== 404) return false
  const b = (r.body ?? {}) as Record<string, unknown>
  return b.error === 'not_found'
}

/** Staging do painel: hostname começa por «staging.» (ex.: staging.app.tredane.com). */
export function isStagingHostname(
  hostname: string = typeof window !== 'undefined' ? window.location.hostname : '',
): boolean {
  return hostname.startsWith('staging.')
}

export function useWhatsappDevSync(api: PanelApi, tenantId: string, generation: number) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<DevSyncResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(): Promise<DevSyncResult | null> {
    setBusy(true)
    setError(null)
    try {
      const r = await api.devSyncExistingWhatsappBinding(tenantId, {
        generation,
        expectGeneration: () => generation,
      })
      setResult(r)
      return r
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha')
      return null
    } finally {
      setBusy(false)
    }
  }

  return { busy, result, error, run }
}

type ActionProps = {
  tenantId: string
  api: PanelApi
  generation: number
  /** Mostra o corpo HTTP bruto (tela dev-sync). */
  showRaw?: boolean
  /** Esconde o botão quando o servidor responde 404 not_found (fora de staging). */
  hideWhenNotFound?: boolean
  onSuccess?: () => void
  className?: string
}

export function WhatsappDevSyncAction({
  tenantId,
  api,
  generation,
  showRaw = false,
  hideWhenNotFound = false,
  onSuccess,
  className = 'panel-btn-primary',
}: ActionProps) {
  const { busy, result, error, run } = useWhatsappDevSync(api, tenantId, generation)

  if (hideWhenNotFound && isNotFoundResult(result)) return null

  async function onPress() {
    const r = await run()
    if (r && r.status === 200 && onSuccess) onSuccess()
  }

  return (
    <div className="whatsapp-dev-sync">
      <Button className={className} isDisabled={busy} onPress={() => void onPress()}>
        {busy ? 'Atualizando…' : DEV_SYNC_BUTTON_LABEL}
      </Button>
      {error ? (
        <p className="clinic-footnote clinic-footnote-warn" role="alert">
          {error}
        </p>
      ) : null}
      {result ? (
        <div role="status">
          <p className="clinic-footnote">{describeDevSyncResult(result.status, result.body)}</p>
          {showRaw ? (
            <pre style={{ whiteSpace: 'pre-wrap' }}>
              {`HTTP ${result.status}\n${JSON.stringify(result.body, null, 2)}`}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
