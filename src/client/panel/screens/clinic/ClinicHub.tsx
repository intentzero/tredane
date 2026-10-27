import { ChevronRight } from 'lucide-react'
import { Button } from 'react-aria-components'
import type { ClinicConfigSnapshot } from '../../api'
import { navigatePanel } from '../../routes'
import { Banner } from '../../states/Banner'

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
        </Banner>
      ) : (
        <Banner tone="ok" title="Pronta para atender">
          <p>Agenda e WhatsApp configurados.</p>
        </Banner>
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
                {readiness.counts.servicesActive === 0
                  ? 'Nenhum serviço cadastrado'
                  : `${readiness.counts.servicesActive} ${readiness.counts.servicesActive === 1 ? 'serviço ativo' : 'serviços ativos'}`}
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
              <span>Dias e horários de atendimento, folgas e bloqueios</span>
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
              <span>Convidar recepcionistas · em breve</span>
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
              <span>Número de WhatsApp da clínica</span>
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
              <span>Conta Pix, prazo e regras do sinal</span>
            </span>
            <ChevronRight aria-hidden size={18} />
          </Button>
        </li>
      </ul>

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
