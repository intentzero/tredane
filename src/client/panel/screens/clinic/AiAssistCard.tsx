import { useState } from 'react'
import type { PanelApi } from '../../api'

type Props = {
  tenantId: string
  api: PanelApi
  generation: number
  initialEnabled: boolean
}

/**
 * Opt-in de IA por clínica (política de privacidade §6). Default desligado.
 * O servidor recusa qualquer sugestão/resumo enquanto estiver desligado.
 */
export function AiAssistCard({ tenantId, api, generation, initialEnabled }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle(next: boolean) {
    setBusy(true)
    setError(null)
    try {
      const s = await api.setClinicAiAssist(tenantId, next, {
        generation,
        expectGeneration: () => generation,
      })
      setEnabled(s.aiAssistEnabled === true)
    } catch {
      setError('Não foi possível salvar. Tente de novo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel-card" aria-labelledby="ai-optin-t">
      <h2 id="ai-optin-t" className="panel-title-md">
        Sugestões com IA
      </h2>
      <label className="panel-switch-row">
        <span>
          <span className="panel-switch-label">Ativar sugestões de resposta</span>
          <span className="panel-muted-sm">
            A equipe pede uma sugestão na conversa e sempre revisa antes de enviar. As mensagens
            não ficam guardadas pelo provedor de IA nem são usadas para treinar modelos.
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="panel-checkbox"
          checked={enabled}
          disabled={busy}
          aria-checked={enabled}
          onChange={(e) => void toggle(e.target.checked)}
          aria-label="Ativar sugestões de resposta com IA"
        />
      </label>
      {error ? (
        <p className="clinic-footnote clinic-footnote-warn" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
