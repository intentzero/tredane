import { EmptyState } from '../states/StatusScreens'
import type { PanelArea } from '../routes'

/** Conteúdo mínimo por área — domínio F2+; #22 entrega shell/auth/nav. */
export function AreaPlaceholder({ area }: { area: PanelArea }) {
  switch (area) {
    case 'conversas':
      return (
        <EmptyState
          title="Nenhuma conversa ainda"
          description="Mensagens enviadas ao WhatsApp da clínica aparecem aqui. Integração de caixa de entrada nas fatias seguintes."
        />
      )
    case 'acompanhamento':
      return (
        <EmptyState
          title="Sem contatos em andamento"
          description="O quadro de acompanhamento (pipeline) fica nesta área. Título da tela: Acompanhamento."
        />
      )
    case 'agenda':
      return (
        <EmptyState
          title="Agenda ainda vazia"
          description="Compromissos do dia e espaços livres aparecem aqui depois da configuração da clínica."
        />
      )
    case 'clinica':
      // Conteúdo real em ClinicArea (#28); placeholder só se rota mal formada.
      return (
        <EmptyState
          title="Configuração da clínica"
          description="Serviços, profissionais, horários, equipe e WhatsApp — só para o responsável (DEC-042)."
        />
      )
  }
}
