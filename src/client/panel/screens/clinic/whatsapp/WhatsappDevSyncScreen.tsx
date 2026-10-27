/**
 * STAGING-ONLY: um botão que chama POST .../whatsapp/dev/sync-existing-binding.
 * O servidor responde 404 fora de staging (ENVIRONMENT + WHATSAPP_DEV_SYNC_ENABLED).
 * A acção (API + mensagens) vive em WhatsappDevSyncAction e é partilhada com WhatsappScreen.
 */
import type { PanelApi } from '../../../api'
import { WhatsappDevSyncAction } from './WhatsappDevSyncAction'
import { Banner } from '../../../states/Banner'

type Props = { tenantId: string; api: PanelApi; generation: number }

export function WhatsappDevSyncScreen({ tenantId, api, generation }: Props) {
  return (
    <div className="clinic-stack whatsapp-stack">
      <Banner tone="info" title="Staging: ligar WhatsApp de teste">
        <p>
          Marca o número de teste já registrado como conectado nesta clínica, para
          permitir o envio de teste. Só funciona em staging, para o dono da clínica.
        </p>
      </Banner>
      <WhatsappDevSyncAction tenantId={tenantId} api={api} generation={generation} showRaw />
    </div>
  )
}
