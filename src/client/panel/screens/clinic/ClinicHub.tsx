import { Clock, DoorOpen, ListChecks, MessageCircle, Users, Wallet } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ClinicConfigSnapshot } from '../../api'
import { navigatePanel, type ClinicaSection } from '../../routes'
import { Banner } from '../../states/Banner'
import { CLINIC_SCOPE_ID, toWeekDraft, windowsOf } from './clinicHours'
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
  const hoursOk = !readiness.missing.includes('weekly_availability')
  const prosOk = readiness.counts.professionalsActive > 0
  const roomsActive = readiness.counts.roomsActive
  const whatsappOk = !readiness.missing.includes('whatsapp')
  const roomsMissing = readiness.missing.includes('room_or_equipment')

  // Passos na ordem em que dependem uns dos outros: o horário vale para as
  // profissionais; as profissionais e as salas valem para os serviços.
  const steps = [
    { label: 'Horário da clínica', ok: hoursOk },
    { label: 'Salas', ok: !roomsMissing },
    { label: 'Profissionais', ok: prosOk },
    { label: 'Serviços', ok: servicesOk },
    { label: 'WhatsApp', ok: whatsappOk },
  ]
  const done = steps.filter((s) => s.ok).length
  const stepsLeft = steps.length - done
  const next = steps.find((s) => !s.ok)

  const weekDraft = toWeekDraft(windowsOf(snap, CLINIC_SCOPE_ID))
  const weekHours = Object.values(weekDraft)
    .flat()
    .reduce((t, w) => t + (w.endMinute - w.startMinute) / 60, 0)
  const services = readiness.counts.servicesActive
  const pros = readiness.counts.professionalsActive

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
              : 'Siga a ordem: horário da clínica, salas, profissionais e serviços. Depois conecte o WhatsApp.'}
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

      <button
        type="button"
        className="hub-week"
        aria-label="Abrir o horário da semana"
        onClick={go('horarios')}
      >
        <span className="hub-week-bars" aria-hidden>
          {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((n, i) => {
            const list = weekDraft[i + 1] ?? []
            const hours = list.reduce((t, w) => t + (w.endMinute - w.startMinute) / 60, 0)
            return (
              <span key={i} className="hub-week-col">
                <i
                  style={{
                    height: hours > 0 ? Math.max(8, Math.round((hours / 12) * 48)) : 6,
                  }}
                  data-open={hours > 0}
                />
                <b>{n}</b>
              </span>
            )
          })}
        </span>
        <span className="hub-week-text">
          <strong>Horário da clínica</strong>
          <span>
            {weekHours > 0 ? `Aberta ${Math.round(weekHours)} h por semana` : 'Sem horário ainda'}
          </span>
        </span>
      </button>

      <h2 className="panel-legend">Agenda</h2>
      <ul className="clinic-nav-list">
        <li>
          <NavRow
            icon={Clock}
            title="1 · Horário da clínica"
            detail="Dias e horas de atendimento, feriados e fechamentos"
            state={hoursOk ? 'ok' : 'todo'}
            onPress={go('horarios')}
          />
        </li>
        <li>
          <NavRow
            icon={DoorOpen}
            title="2 · Salas e equipamentos"
            detail={
              roomsActive === 0
                ? 'Nenhuma ainda · só se algum serviço precisar'
                : `${roomsActive} ${roomsActive === 1 ? 'sala ou equipamento' : 'salas e equipamentos'}`
            }
            state={roomsMissing ? 'todo' : 'ok'}
            onPress={() =>
              navigatePanel({
                kind: 'area',
                area: 'clinica',
                tenantId,
                section: 'recursos',
                entityId: 'salas',
              })
            }
          />
        </li>
        <li>
          <NavRow
            icon={Users}
            title="3 · Profissionais"
            detail={
              pros === 0
                ? 'Nenhuma cadastrada'
                : `${pros} ${pros === 1 ? 'profissional' : 'profissionais'}`
            }
            state={prosOk ? 'ok' : 'todo'}
            onPress={() =>
              navigatePanel({
                kind: 'area',
                area: 'clinica',
                tenantId,
                section: 'recursos',
                entityId: 'profissionais',
              })
            }
          />
        </li>
        <li>
          <NavRow
            icon={ListChecks}
            title="4 · Serviços"
            detail={
              services === 0
                ? 'Nenhum serviço cadastrado'
                : `${services} ${services === 1 ? 'serviço ativo' : 'serviços ativos'}`
            }
            state={servicesOk ? 'ok' : 'todo'}
            onPress={go('servicos')}
          />
        </li>
      </ul>

      <h2 className="panel-legend">Atendimento</h2>
      <ul className="clinic-nav-list">
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
            detail="Opcional · conta Pix, prazo e regras do sinal"
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
