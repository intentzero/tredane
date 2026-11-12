import { Clock, DoorOpen, ListChecks, MessageCircle, Sparkles, TriangleAlert, Users, Wallet } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from 'react-aria-components'
import type { ClinicConfigSnapshot } from '../../api'
import { navigatePanel, type ClinicaSection } from '../../routes'
import { Badge } from '../../states/Badge'
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

  // DEC-163: com a clínica em uso, cada linha diz o valor atual, não a instrução.
  const activeNames = (kind: 'professional' | 'room' | 'equipment') =>
    (snap.resources ?? []).filter((r) => r.active && r.kind === kind).map((r) => r.name)
  const listNames = (names: string[]) =>
    names.length <= 1
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`
  const prices = (snap.services ?? [])
    .filter((sv) => sv.active && sv.priceCents != null)
    .map((sv) => sv.priceCents as number)
  const brl = (cents: number) =>
    new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100)
  const priceRange =
    prices.length > 0
      ? Math.min(...prices) === Math.max(...prices)
        ? ` · ${brl(prices[0]!)}`
        : ` · de ${brl(Math.min(...prices))} a ${brl(Math.max(...prices))}`
      : ''
  const roomNames = [...activeNames('room'), ...activeNames('equipment')]
  const proNames = activeNames('professional')

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
  const inUse = stepsLeft <= 1
  const prosValue = proNames.length > 0 ? listNames(proNames) : prosDetail
  const roomsValue = roomNames.length > 0 ? listNames(roomNames) : roomsDetail
  const servicesValue = services > 0 ? `${servicesDetail}${priceRange}` : servicesDetail

  const optionalRows = (
    <>
      {showAssistant ? (
        <li>
          <NavRow
            icon={Sparkles}
            title="Assistente e automações"
            detail={
              inUse
                ? snap.settings?.aiAssistEnabled
                  ? 'Sugestões com IA ligadas'
                  : 'Sugestões com IA desligadas'
                : 'Sugestões com IA, atendente virtual e limites de proteção'
            }
            state="neutral"
            onPress={go('assistente')}
          />
        </li>
      ) : null}
      <li>
        <NavRow
          icon={Wallet}
          title="Recebimento de sinais"
          detail={inUse ? 'Opcional · sinal por Pix' : 'Opcional · conta Pix, prazo e regras do sinal'}
          state="neutral"
          onPress={go('recebimento')}
        />
      </li>
      <li>
        <NavRow
          icon={Users}
          title="Equipe"
          detail="Convidar atendentes"
          state="neutral"
          onPress={go('equipe')}
        />
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
    <div className={`clinic-stack${stepsLeft === 0 ? ' clinic-stack--hub' : ''}`}>
      {!inUse && next ? (
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
          {stepsLeft === 1 && next ? (
            // DEC-163 (M-71): o passo que falta numa faixa de uma linha; o resto é o índice.
            <section className="hub-strip" aria-labelledby="hub-strip-t">
              <span className="hub-strip-text">
                <strong id="hub-strip-t">
                  {next.label === 'WhatsApp' ? 'Falta conectar o WhatsApp' : `Falta: ${next.label}`}
                </strong>
                <span>
                  {done} de {steps.length} passos prontos.
                  {next.label === 'WhatsApp' ? ' Sem ele, nenhuma conversa chega.' : ''}
                </span>
              </span>
              <Button className="panel-btn-primary hub-strip-cta" onPress={next.go}>
                {next.label === 'WhatsApp' ? 'Conectar' : next.cta}
              </Button>
            </section>
          ) : (
            <Banner tone="ok" title="Pronta para atender">
              <p>Agenda e WhatsApp configurados.</p>
            </Banner>
          )}

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

          <div className="hub-groups">
            <section className="hub-group">
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
              {!hoursOk ? <Badge tone="wait">Falta</Badge> : null}
            </span>
          </button>
            </section>
            <section className="hub-group">
              <h2 className="panel-legend">Quem, o quê e onde</h2>
          <ul className="clinic-nav-list">
            <li>
              <NavRow
                icon={Users}
                title="Profissionais"
                detail={prosValue}
                state={prosOk ? 'neutral' : 'todo'}
                onPress={goEntity('recursos', 'profissionais')}
              />
            </li>
            <li>
              <NavRow
                icon={ListChecks}
                title="Serviços"
                detail={servicesValue}
                state={servicesOk ? 'neutral' : 'todo'}
                onPress={go('servicos')}
              />
            </li>
            <li>
              <NavRow
                icon={DoorOpen}
                title="Salas e equipamentos"
                detail={roomsValue}
                onPress={goEntity('recursos', 'salas')}
              />
            </li>
          </ul>
            </section>
            <section className="hub-group">
              <h2 className="panel-legend">Como fala com as clientes</h2>
          <ul className="clinic-nav-list">
            <li>
              <NavRow
                icon={MessageCircle}
                title="WhatsApp"
                detail={whatsappOk ? 'Conectado' : 'Não conectado'}
                state={whatsappOk ? 'neutral' : 'todo'}
                onPress={go('whatsapp')}
              />
            </li>
            {optionalRows}
          </ul>
            </section>
          </div>
        </>
      )}

      {stagingCard ? (
        // DEC-163: ferramenta de staging recolhida no fim, longe do uso diário.
        <details className="hub-staging">
          <summary>Staging: repor a clínica ao estado inicial</summary>
          {stagingCard}
        </details>
      ) : null}

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
