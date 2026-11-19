import { BookOpen, ShieldCheck, UserRound } from 'lucide-react'
import type { ClinicConfigSnapshot, PanelApi } from '../../api'
import { navigatePanel, type ClinicaSection } from '../../routes'
import { AiAssistCard, AiSuggestCard } from './AiAssistCard'
import { NavRow } from './NavRow'
import { OnlineAgendaCard } from './OnlineAgendaCard'

/**
 * DEC-212: o Assistente é um índice. Dois interruptores no topo (atendimento automático e agenda
 * online) e uma linha por assunto com o valor atual; cada linha abre a sua subtela.
 */
export function AssistantHub({
  tenantId,
  api,
  generation,
  snap,
  isOwner,
}: {
  tenantId: string
  api: PanelApi
  generation: number
  snap: ClinicConfigSnapshot
  isOwner: boolean
}) {
  const go = (section: ClinicaSection) => () =>
    navigatePanel({ kind: 'area', area: 'clinica', tenantId, section })
  const s = snap.settings
  const name = s.virtualAttendantName?.trim()
  const gender =
    s.virtualAttendantGender === 'feminino'
      ? 'feminino'
      : s.virtualAttendantGender === 'masculino'
        ? 'masculino'
        : 'neutro'
  const hasLink = Boolean(s.googleBusinessUrl?.trim())
  return (
    <div className="clinic-stack">
      <AiAssistCard
        tenantId={tenantId}
        api={api}
        generation={generation}
        initialEnabled={s.aiAssistEnabled === true}
      />
      <AiSuggestCard
        tenantId={tenantId}
        api={api}
        generation={generation}
        initialEnabled={s.aiSuggestEnabled === true}
      />
      {isOwner ? <OnlineAgendaCard tenantId={tenantId} api={api} generation={generation} /> : null}
      {isOwner ? (
        <ul className="clinic-nav-list" aria-label="Configurar o assistente">
          <li>
            <NavRow
              icon={BookOpen}
              title="Respostas da clínica"
              detail={`${hasLink ? 'Localização preenchida' : 'Sem link de localização'} · regras e perguntas frequentes`}
              state={hasLink ? 'neutral' : 'todo'}
              onPress={go('conhecimento')}
            />
          </li>
          <li>
            <NavRow
              icon={UserRound}
              title="Como se apresenta"
              detail={`${name || 'Sem nome'} · ${gender}`}
              state="neutral"
              onPress={go('assistente-persona')}
            />
          </li>
          <li>
            <NavRow
              icon={ShieldCheck}
              title="Proteções"
              detail="Limites de respostas e de marcações por cliente"
              state="neutral"
              onPress={go('assistente-protecoes')}
            />
          </li>
        </ul>
      ) : null}
    </div>
  )
}
