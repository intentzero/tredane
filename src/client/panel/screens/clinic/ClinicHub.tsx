import { ChevronRight } from 'lucide-react'
import { Button } from 'react-aria-components'
import type { ClinicConfigSnapshot } from '../../api'
import { navigatePanel } from '../../routes'

type Props = {
  tenantId: string
  snap: ClinicConfigSnapshot
}

function statusLabel(ok: boolean): { text: string; className: string } {
  return ok
    ? { text: 'Pronto', className: 'clinic-status-ok' }
    : { text: 'Falta configurar', className: 'clinic-status-warn' }
}

export function ClinicHub({ tenantId, snap }: Props) {
  const { readiness } = snap
  const pending = readiness.missing.filter((m) => m !== 'whatsapp')
  const stepsLeft = pending.length + (readiness.missing.includes('whatsapp') ? 1 : 0)

  const servicesOk = readiness.counts.servicesActive > 0
  const resourcesOk =
    readiness.counts.professionalsActive > 0 && readiness.counts.roomsActive > 0
  const hoursOk = !readiness.missing.includes('weekly_availability')

  return (
    <div className="clinic-stack">
      {stepsLeft > 0 ? (
        <section className="clinic-banner" aria-labelledby="clinic-pending">
          <h2 id="clinic-pending">
            {stepsLeft === 1
              ? 'Falta 1 passo para atender'
              : `Faltam ${stepsLeft} passos para atender`}
          </h2>
          <p>
            {readiness.agendaConfigured
              ? 'Conecte o WhatsApp da clínica para receber conversas. A agenda já está pronta para marcar horários.'
              : 'Cadastre serviços, profissionais, salas e expediente antes de liberar agendamentos.'}
          </p>
        </section>
      ) : (
        <section className="clinic-banner clinic-banner-ok" aria-labelledby="clinic-ready">
          <h2 id="clinic-ready">Pronta para atender</h2>
          <p>Configuração mínima da agenda e do canal concluída.</p>
        </section>
      )}

      <ul className="clinic-nav-list">
        <li>
          <Button
            className="clinic-nav-row"
            onPress={() =>
              navigatePanel({
                kind: 'area',
                area: 'clinica',
                tenantId,
                section: 'servicos',
              })
            }
          >
            <span className="clinic-nav-copy">
              <strong>Serviços</strong>
              <span>
                {readiness.counts.servicesActive} activos · duração e intervalo
              </span>
            </span>
            <span className={statusLabel(servicesOk).className}>
              {statusLabel(servicesOk).text}
            </span>
            <ChevronRight aria-hidden size={18} />
          </Button>
        </li>
        <li>
          <Button
            className="clinic-nav-row"
            onPress={() =>
              navigatePanel({
                kind: 'area',
                area: 'clinica',
                tenantId,
                section: 'recursos',
              })
            }
          >
            <span className="clinic-nav-copy">
              <strong>Profissionais e salas</strong>
              <span>
                {readiness.counts.professionalsActive} profissionais ·{' '}
                {readiness.counts.roomsActive} salas e equipamentos
              </span>
            </span>
            <span className={statusLabel(resourcesOk).className}>
              {statusLabel(resourcesOk).text}
            </span>
            <ChevronRight aria-hidden size={18} />
          </Button>
        </li>
        <li>
          <Button
            className="clinic-nav-row"
            onPress={() =>
              navigatePanel({
                kind: 'area',
                area: 'clinica',
                tenantId,
                section: 'horarios',
              })
            }
          >
            <span className="clinic-nav-copy">
              <strong>Horários e bloqueios</strong>
              <span>Expediente semanal e folgas · {readiness.timezone}</span>
            </span>
            <span className={statusLabel(hoursOk).className}>
              {statusLabel(hoursOk).text}
            </span>
            <ChevronRight aria-hidden size={18} />
          </Button>
        </li>
        <li>
          <div className="clinic-nav-row clinic-nav-row-static">
            <span className="clinic-nav-copy">
              <strong>Equipe</strong>
              <span>Convites e remoção — API em #25; UI nesta área em fatia posterior</span>
            </span>
            <ChevronRight aria-hidden size={18} />
          </div>
        </li>
        <li>
          <Button
            className="clinic-nav-row"
            onPress={() =>
              navigatePanel({
                kind: 'area',
                area: 'clinica',
                tenantId,
                section: 'whatsapp',
              })
            }
          >
            <span className="clinic-nav-copy">
              <strong>WhatsApp</strong>
              <span>Número da clínica · Embedded Signup</span>
            </span>
            <span
              className={
                statusLabel(!readiness.missing.includes('whatsapp')).className
              }
            >
              {readiness.missing.includes('whatsapp')
                ? 'Falta conectar'
                : 'Pronto'}
            </span>
            <ChevronRight aria-hidden size={18} />
          </Button>
        </li>
        <li>
          <Button
            className="clinic-nav-row"
            onPress={() =>
              navigatePanel({
                kind: 'area',
                area: 'clinica',
                tenantId,
                section: 'recebimento',
              })
            }
          >
            <span className="clinic-nav-copy">
              <strong>Recebimento de sinais</strong>
              <span>Conta Pix Woovi · prazo e política (M-33)</span>
            </span>
            <ChevronRight aria-hidden size={18} />
          </Button>
        </li>
      </ul>

      <p className="clinic-footnote">
        Só o responsável vê e altera esta área. Atendentes consultam serviços pela
        agenda, sem editar configuração (DEC-042).
      </p>
      {!readiness.schedulingAllowed ? (
        <p className="clinic-footnote clinic-footnote-warn" role="status">
          Agendamento ainda não liberado: configuração incompleta.
        </p>
      ) : null}
    </div>
  )
}
