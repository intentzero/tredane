import {
  Clock,
  DoorOpen,
  ListChecks,
  MessageCircle,
  Users,
  Wallet,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { ClinicConfigSnapshot } from '../../api'
import { navigatePanel, type ClinicaSection } from '../../routes'
import { Banner } from '../../states/Banner'
import { NavRow } from './NavRow'

type Props = {
  tenantId: string
  snap: ClinicConfigSnapshot
  /** Cartão do opt-in de IA (Configurações da clínica). */
  aiCard?: ReactNode
  /** STAGING-ONLY (dono): reset dos dados operacionais. */
  stagingCard?: ReactNode
}

export function ClinicHub({ tenantId, snap, aiCard, stagingCard }: Props) {
  const { readiness } = snap
  const go = (section: ClinicaSection) => () =>
    navigatePanel({ kind: 'area', area: 'clinica', tenantId, section })

  const servicesOk = readiness.counts.servicesActive > 0
  const resourcesOk =
    readiness.counts.professionalsActive > 0 && readiness.counts.roomsActive > 0
  const hoursOk = !readiness.missing.includes('weekly_availability')
  const whatsappOk = !readiness.missing.includes('whatsapp')

  // Quatro etapas para começar a atender; a barra e o título usam a mesma conta.
  const steps = [
    { label: 'Serviços', ok: servicesOk },
    { label: 'Profissionais e salas', ok: resourcesOk },
    { label: 'Horários e bloqueios', ok: hoursOk },
    { label: 'WhatsApp', ok: whatsappOk },
  ]
  const done = steps.filter((s) => s.ok).length
  const stepsLeft = steps.length - done
  const next = steps.find((s) => !s.ok)

  const services = readiness.counts.servicesActive

  return (
    <div className="clinic-stack">
      {stepsLeft > 0 ? (
        <Banner
          tone="warn"
          title={
            stepsLeft === 1
              ? 'Falta 1 passo para atender'
              : `Faltam ${stepsLeft} passos para atender`
          }
        >
          <p>
            {readiness.agendaConfigured
              ? 'Conecte o WhatsApp da clínica para receber conversas. A agenda já está pronta para marcar horários.'
              : 'Cadastre serviços, profissionais, salas e horários de atendimento para começar a marcar horários.'}
          </p>
          <div
            className="panel-progress"
            role="progressbar"
            aria-label="Etapas prontas"
            aria-valuemin={0}
            aria-valuemax={steps.length}
            aria-valuenow={done}
            aria-valuetext={`${done} de ${steps.length} etapas prontas`}
          >
            <i style={{ width: `${(done / steps.length) * 100}%` }} />
          </div>
          <p className="panel-progress-label">
            {done} de {steps.length} etapas prontas
            {next ? ` · Próxima: ${next.label}` : ''}
          </p>
        </Banner>
      ) : (
        <Banner tone="ok" title="Pronta para atender">
          <p>Agenda e WhatsApp configurados.</p>
        </Banner>
      )}

      <ul className="clinic-nav-list">
        <li>
          <NavRow
            icon={ListChecks}
            title="Serviços"
            detail={
              services === 0
                ? 'Nenhum serviço cadastrado'
                : `${services} ${services === 1 ? 'serviço ativo' : 'serviços ativos'}`
            }
            state={servicesOk ? 'ok' : 'todo'}
            onPress={go('servicos')}
          />
        </li>
        <li>
          <NavRow
            icon={DoorOpen}
            title="Profissionais e salas"
            detail={`${readiness.counts.professionalsActive} profissionais · ${readiness.counts.roomsActive} salas e equipamentos`}
            state={resourcesOk ? 'ok' : 'todo'}
            onPress={go('recursos')}
          />
        </li>
        <li>
          <NavRow
            icon={Clock}
            title="Horários e bloqueios"
            detail="Dias e horários de atendimento, folgas e bloqueios"
            state={hoursOk ? 'ok' : 'todo'}
            onPress={go('horarios')}
          />
        </li>
        <li>
          <NavRow
            icon={MessageCircle}
            title="WhatsApp"
            detail="Número de WhatsApp da clínica"
            state={whatsappOk ? 'ok' : 'todo'}
            onPress={go('whatsapp')}
          />
        </li>
        <li>
          <NavRow
            icon={Wallet}
            title="Recebimento de sinais"
            detail="Conta Pix, prazo e regras do sinal"
            state="neutral"
            onPress={go('recebimento')}
          />
        </li>
        <li>
          <NavRow
            icon={Users}
            title="Equipe"
            detail="Convidar recepcionistas"
            state="neutral"
            soon
          />
        </li>
      </ul>

      {aiCard ?? null}

      {stagingCard ?? null}

      <p className="clinic-footnote">
        Só o responsável pela clínica vê e altera esta área. Atendentes consultam serviços pela
        agenda, sem alterar as configurações.
      </p>
      {!readiness.schedulingAllowed ? (
        <p className="clinic-footnote clinic-footnote-warn" role="status">
          Agendamento ainda não liberado: configuração incompleta.
        </p>
      ) : null}
    </div>
  )
}
