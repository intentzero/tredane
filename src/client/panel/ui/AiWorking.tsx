import { Sparkles } from 'lucide-react'

/**
 * Indicador único «IA a trabalhar» — rascunho automático, «Gerar outra» e resumo.
 * Anunciado a leitores de ecrã (role=status); animação respeita reduced-motion.
 */
export function AiWorking({ label = 'IA escrevendo…', compact = false }: { label?: string; compact?: boolean }) {
  return (
    <span className={`ai-working${compact ? ' ai-working--compact' : ''}`} role="status" aria-live="polite">
      <Sparkles aria-hidden size={14} strokeWidth={2} className="ai-working-icon" />
      <span className="ai-working-label">{label}</span>
      <span className="ai-working-dots" aria-hidden>
        <span />
        <span />
        <span />
      </span>
    </span>
  )
}
