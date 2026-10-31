import { Clock, DoorOpen, ListChecks, MessageCircle, Sparkles, TriangleAlert, Users, Wallet } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from 'react-aria-components'
import type { ClinicConfigSnapshot } from '../../api'
import { navigatePanel, type ClinicaSection } from '../../routes'
import { Banner } from '../../states/Banner'
import { CLINIC_SCOPE_ID, toWeekDraft, windowsOf } from './clinicHours'
import { NavRow } from './NavRow'
import { pendingCounts } from './resourceRows'

type Props = {
  tenantId: string
  snap: ClinicConfigSnapshot
  /** Só a responsável vê «Assistente e automações» (DEC-042). */
  showAssistant?: boolean
  /** STAGING-ONLY (dono): reset dos dados operacionais. */
  stagingCard?: ReactNode
}

export function ClinicHub({ tenantId, snap, showAssistant = true, stagingCard }: Props) {
  const { readiness } = snap
  const go = (section: ClinicaSection) => () =>
    navigatePanel({ kind: 'area', area: 'clinica', tenantId, section })

  const servicesOk = readiness.counts.servicesActive > 0
  const hoursOk = !readiness.missing.includes('weekly_availability')
  const prosOk = readiness.counts.professionalsActive > 0
  const roomsActive = readiness.counts.roomsActive
  const whatsappOk = !readiness.missing.includes('whatsapp')
  const roomsMissing = readiness.missing.includes('room_or_equipment')

  const goEntity = (section: ClinicaSection, entityId?: string) => () =>
    navigatePanel({ kind: 'area', area: 'clinica', tenantId, section, entityId })

  // Passos na ordem em que dependem uns dos outros: o horário vale para as
  // profissionais; as profissionais e as salas valem para os serviços.
  const steps = [
    {
      label: 'Horário da clínica',
      ok: hoursOk,
      why: 'Dias e horas de atendimento, feriados e fechamentos',
      cta: 'Definir horário',
      go: go('horarios'),
    },
    {
      label: 'Salas',
      ok: !roomsMissing,
      why: 'Só se algum serviço precisar; pode pular',
      cta: 'Cadastrar sala',
      go: goEntity('sala', 'novo'),
    },
    {
      label: 'Profissionais',
      ok: prosOk,
      why: 'Cadastre cada profissional e os dias em que trabalha',
      cta: 'Adicionar profissional',
      go: goEntity('profissional', 'novo'),
    },
    {
      label: 'Serviços',
      ok: servicesOk,
      why: 'Depois das profissionais: escolhe quem faz e onde',
      cta: 'Adicionar serviço',
      go: goEntity('servico', 'novo'),
    },
    {
      label: 'WhatsApp',
      ok: whatsappOk,
      why: 'Não depende dos outros; pode conectar já',
      cta: 'Conectar WhatsApp',
      go: go('whatsapp'),
    },
  ]
  const done = steps.filter((s) => s.ok).length
  const stepsLeft = steps.length - done
  const nextIndex = steps.findIndex((s) => !s.ok)
  const next = nextIndex >= 0 ? steps[nextIndex] : undefined

  const weekDraft = toWeekDraft(windowsOf(snap, CLINIC_SCOPE_ID))
  const weekHours = Object.values(weekDraft)
    .flat()
    .reduce((t, w) => t + (w.endMinute - w.startMinute) / 60, 0)
  const services = readiness.counts.servicesActive
  const pros = readiness.counts.professionalsActive

  const roomsDetail =
    roomsActive === 0
      ? 'Nenhuma ainda · só se algum serviço precisar'
      : `${roomsActive} ${roomsActive === 1 ? 'sala ou equipamento' : 'salas e equipamentos'}`
  const prosDetail =
    pros === 0 ? 'Nenhuma cadastrada' : `${pros} ${pros === 1 ? 'profissional' : 'profissionais'}`
  const servicesDetail =
    services === 0
      ? 'Nenhum serviço cadastrado'
      : `${services} ${services === 1 ? 'serviço ativo' : 'serviços ativos'}`

  const optionalRows = (
    <>
      {showAssistant ? (
        <li>
          <NavRow
            icon={Sparkles}
            title="Assistente e automações"
            detail="Sugestões com IA, atendente virtual e limites de proteção"
            state="neutral"
            onPress={go('assistente')}
          />
        </li>
      ) : null}
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
        <NavRow icon={Users} title="Equipe" detail="Convidar recepcionistas" state="neutral" soon />
      </li>
    </>
  )

  let pendingServices = 0
  try {
    pendingServices = stepsLeft === 0 ? pendingCounts(snap, Date.now()).services : 0
  } catch {
    pendingServices = 0
  }

  return (
    <div className="clinic-stack">
      {stepsLeft > 0 && next ? (
        <>
          <section className="hub-next" aria-labelledby="hub-next-t">
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
              {stepsLeft === 1 ? 'Falta 1 passo para atender' : `Faltam ${stepsLeft} passos para atender`}
              {' · '}
              {done} de {steps.length} etapas prontas · Próxima: {next.label}
            </p>
            <span className="hub-next-eyebrow">Agora · passo {nextIndex + 1}</span>
            <h2 id="hub-next-t" className="hub-next-title">
              {next.label}
            </h2>
            <p className="hub-next-why">{next.why}</p>
            <Button className="panel-btn-primary hub-next-cta" onPress={next.go}>
              {next.cta}
            </Button>
          </section>

          <h2 className="panel-legend">O caminho</h2>
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
                detail={roomsDetail}
                state={roomsMissing ? 'todo' : 'ok'}
                onPress={goEntity('recursos', 'salas')}
              />
            </li>
            <li>
              <NavRow
                icon={Users}
                title="3 · Profissionais"
                detail={prosDetail}
                state={prosOk ? 'ok' : 'todo'}
                onPress={goEntity('recursos', 'profissionais')}
              />
            </li>
            <li>
              <NavRow
                icon={ListChecks}
                title="4 · Serviços"
                detail={servicesDetail}
                state={servicesOk ? 'ok' : 'todo'}
                onPress={go('servicos')}
              />
            </li>
            <li>
              <NavRow
                icon={MessageCircle}
                title="5 · WhatsApp"
                detail="Número de WhatsApp da clínica"
                state={whatsappOk ? 'ok' : 'todo'}
                onPress={go('whatsapp')}
              />
            </li>
          </ul>

          <h2 className="panel-legend">Depois, se quiser</h2>
          <ul className="clinic-nav-list">{optionalRows}</ul>
        </>
      ) : (
        <>
          <Banner tone="ok" title="Pronta para atender">
            <p>Agenda e WhatsApp configurados.</p>
          </Banner>

          {pendingServices > 0 ? (
            <Button className="hub-alert" onPress={go('conferir')}>
              <TriangleAlert aria-hidden size={20} />
              <span>
                <strong>
                  {pendingServices === 1
                    ? '1 serviço não pode ser marcado'
                    : `${pendingServices} serviços não podem ser marcados`}
                </strong>
                <span>Conferir quem faz, onde e quando</span>
              </span>
              <b>Resolver</b>
            </Button>
          ) : null}

          <h2 className="panel-legend">Quando atende</h2>
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
              <strong>Horário e folgas</strong>
              <span>
                {weekHours > 0
                  ? `Aberta ${Math.round(weekHours)} h por semana`
                  : 'Sem horário da clínica · cada profissional tem o seu'}
              </span>
            </span>
          </button>

          <h2 className="panel-legend">Quem, o quê e onde</h2>
          <ul className="clinic-nav-list">
            <li>
              <NavRow
                icon={Users}
                title="Profissionais"
                detail={prosDetail}
                onPress={goEntity('recursos', 'profissionais')}
              />
            </li>
            <li>
              <NavRow icon={ListChecks} title="Serviços" detail={servicesDetail} onPress={go('servicos')} />
            </li>
            <li>
              <NavRow
                icon={DoorOpen}
                title="Salas e equipamentos"
                detail={roomsDetail}
                onPress={goEntity('recursos', 'salas')}
              />
            </li>
          </ul>

          <h2 className="panel-legend">Como fala com as clientes</h2>
          <ul className="clinic-nav-list">
            <li>
              <NavRow
                icon={MessageCircle}
                title="WhatsApp"
                detail="Número de WhatsApp da clínica"
                onPress={go('whatsapp')}
              />
            </li>
            {optionalRows}
          </ul>
        </>
      )}

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
