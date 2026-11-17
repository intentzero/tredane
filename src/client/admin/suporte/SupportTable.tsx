import type { SupportItem } from '../api'
import { Pill } from '../AdminUi'
import {
  SUPPORT_LABEL,
  SUPPORT_TONE,
  formatReading,
  personLabel,
  supportDetail,
  supportTiming,
} from '../format'
import { clinicaHref, navigateAdmin } from '../routes'
import { SupportActions } from './SupportActions'

/** Tabela partilhada por PA-05 (todas as clínicas) e PA-10 (uma clínica). */
export function SupportTable({
  items,
  showClinic,
  onChanged,
}: {
  items: SupportItem[]
  showClinic: boolean
  onChanged: (message: string) => void
}) {
  return (
    <div className="admin-card admin-card--flush">
      <div className="admin-table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">{showClinic ? 'Clínica' : 'Pedido em'}</th>
              <th scope="col">Para</th>
              <th scope="col">Motivo</th>
              <th scope="col">Estado</th>
              <th scope="col">Prazo / duração</th>
              <th scope="col">Ações</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => {
              const detail = supportDetail(i)
              const href = clinicaHref(i.tenantId, 'suporte')
              return (
                <tr key={i.requestId}>
                  <th scope="row">
                    {showClinic ? (
                      <a
                        href={href}
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                          e.preventDefault()
                          navigateAdmin(href)
                        }}
                      >
                        {i.tenantName}
                      </a>
                    ) : (
                      formatReading(i.createdAt)
                    )}
                    {showClinic ? <span className="admin-muted admin-block">{formatReading(i.createdAt)}</span> : null}
                  </th>
                  <td>
                    {personLabel(i.subject)}
                    <span className="admin-muted admin-block">pedido por {personLabel(i.actor)}</span>
                  </td>
                  <td>{i.reason}</td>
                  <td>
                    <Pill tone={SUPPORT_TONE[i.state]}>{SUPPORT_LABEL[i.state]}</Pill>
                    {detail ? <span className="admin-muted admin-block">{detail}</span> : null}
                  </td>
                  <td>{supportTiming(i)}</td>
                  <td>
                    <SupportActions item={i} onChanged={onChanged} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
