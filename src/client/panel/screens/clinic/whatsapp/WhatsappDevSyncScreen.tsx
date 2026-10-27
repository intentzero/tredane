/**
 * STAGING-ONLY: um botão que chama POST .../whatsapp/dev/sync-existing-binding.
 * O servidor responde 404 fora de staging (ENVIRONMENT + WHATSAPP_DEV_SYNC_ENABLED).
 * A acção (API + mensagens) vive em WhatsappDevSyncAction e é partilhada com WhatsappScreen.
 */
import type { PanelApi } from '../../../api'
import { WhatsappDevSyncAction } from './WhatsappDevSyncAction'

type Props = { tenantId: string; api: PanelApi; generation: number }

export function WhatsappDevSyncScreen({ tenantId, api, generation }: Props) {
  return (
    <div className="clinic-stack whatsapp-stack">
      <section className="clinic-banner" aria-labelledby="wa-devsync-title">
        <h2 id="wa-devsync-title">Staging: ligar WhatsApp de teste</h2>
        <p>
          Marca o número de teste já registrado como conectado nesta clínica, para
          permitir o envio de teste. Só funciona em staging, para o dono da clínica.
        </p>
      </section>
      <WhatsappDevSyncAction tenantId={tenantId} api={api} generation={generation} showRaw />
    </div>
  )
}
