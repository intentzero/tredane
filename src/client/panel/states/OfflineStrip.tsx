import { WifiOff } from 'lucide-react'

/** Faixa de topo quando a conexão cai. Some sozinha quando volta. */
export function OfflineStrip() {
  return (
    <div className="panel-strip panel-strip-offline" role="status" aria-live="assertive">
      <WifiOff aria-hidden size={18} strokeWidth={2} />
      <p>
        Sem conexão. Os dados podem estar desatualizados, e agenda e pagamento só
        são confirmados quando a internet voltar.
      </p>
    </div>
  )
}
