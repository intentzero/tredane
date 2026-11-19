import { Users } from 'lucide-react'
import { useAuthSession } from '../../auth/AuthContext'
import { useTenant } from '../../tenant/TenantContext'
import { LoadingState } from '../../states/StatusScreens'
import type { ClientesSection } from '../../routes'
import { useMediaQuery } from '../../ui/useMediaQuery'
import { InboxContactScreen } from '../inbox/InboxContact'
import { ClientesList } from './ClientesList'

type Props = {
  tenantId: string
  section: ClientesSection
  contactId?: string
}

/**
 * Área Clientes (Opção C Confirmada, Paulo 31/10/2026): lista + ficha partilhada com Contato.
 * Fase 1 = só leitura (dados, conversas, horários). Sem sexo / prontuário.
 * Desktop: chrome em `.panel-shell-header` (como Agenda); coluna da lista só busca/filtros/lista.
 */
export function ClientesArea({ tenantId, section, contactId }: Props) {
  const { api, status } = useAuthSession()
  const { generation, active } = useTenant()
  const wide = useMediaQuery('(min-width: 1280px)')
  const isOwner = active.phase === 'ready' && active.context.role === 'owner'

  if (!api || status.phase !== 'ready') {
    return <LoadingState label="Preparando sessão…" />
  }

  if (wide) {
    return (
      <div className="clientes-2col">
        <section className="clientes-2col-list" aria-label="Lista de clientes">
          <ClientesList
            tenantId={tenantId}
            api={api}
            generation={generation}
            activeContactId={section === 'ficha' ? contactId : undefined}
          />
        </section>
        <section className="clientes-2col-ficha" aria-label="Ficha">
          {section === 'ficha' && contactId ? (
            <InboxContactScreen
              tenantId={tenantId}
              contactId={contactId}
              api={api}
              generation={generation}
              isOwner={isOwner}
              origin="clientes"
            />
          ) : (
            <div className="clientes-empty-pane">
              <Users aria-hidden size={40} strokeWidth={1.6} />
              <h2>Escolha um cliente</h2>
              <p>
                A ficha mostra os mesmos dados do Contato da conversa — sem precisar de abrir a
                thread.
              </p>
            </div>
          )}
        </section>
      </div>
    )
  }

  if (section === 'ficha' && contactId) {
    return (
      <InboxContactScreen
        tenantId={tenantId}
        contactId={contactId}
        api={api}
        generation={generation}
        isOwner={isOwner}
        origin="clientes"
      />
    )
  }

  return (
    <div className="clientes-mobile">
      <ClientesList
        tenantId={tenantId}
        api={api}
        generation={generation}
      />
    </div>
  )
}
