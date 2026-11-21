/**
 * Medição do encaminhamento léxico (DEC-202 / DEC-221). Não é gate: imprime precisão e recall por
 * classe e a lista de falhas. As asserções só protegem a integridade do corpus.
 */
import { describe, expect, it } from 'vitest'
import { routeToClientWeb } from '../../../../clientweb/route-intent'
import { listServices } from '../../../config/services'
import { bootDialogScenario } from '../dialogs/scenario'
import { AGENDA_INTENT_LABELS, INTENT_CORPUS, type IntentLabel, type IntentSample } from './corpus'

const LABELS: IntentLabel[] = [
  'agendar',
  'remarcar',
  'cancelar',
  'misto',
  'price',
  'team',
  'faq_catalog',
  'nenhum',
]

function predict(
  text: string,
  services: Parameters<typeof routeToClientWeb>[0]['services'],
  hasUpcoming: boolean,
): { label: IntentLabel; serviceId: string | null } {
  const r = routeToClientWeb({ text, services, hasUpcoming })
  if (!r) return { label: 'nenhum', serviceId: null }
  if (r.purpose === 'remarcar') return { label: 'remarcar', serviceId: null }
  if (r.purpose === 'cancelar') return { label: 'cancelar', serviceId: null }
  return { label: r.mixed ? 'misto' : 'agendar', serviceId: r.serviceId }
}

function isAgendaLabel(label: IntentLabel): boolean {
  return AGENDA_INTENT_LABELS.includes(label)
}

describe('corpus de intenção (medição léxica)', () => {
  it('o corpus é válido e tem a dimensão prevista', () => {
    expect(INTENT_CORPUS.length).toBeGreaterThanOrEqual(150)
    for (const s of INTENT_CORPUS) {
      expect(LABELS).toContain(s.label)
      expect(s.text.trim().length).toBeGreaterThan(1)
    }
    expect(new Set(INTENT_CORPUS.map((s) => s.text + String(s.upcoming))).size).toBe(INTENT_CORPUS.length)
  })

  it('relatório: precisão e recall do léxico por classe', () => {
    const s = bootDialogScenario({})
    try {
      const services = listServices(s.db, s.tenantId).filter((x) => x.active)
      const idByName = new Map(services.map((x) => [x.name, x.id]))
      const confusion = new Map<string, number>()
      const failures: Array<{ sample: IntentSample; got: string }> = []
      let serviceChecked = 0
      let serviceOk = 0
      for (const sample of INTENT_CORPUS) {
        const hasUpcoming = sample.upcoming ?? (sample.label === 'remarcar' || sample.label === 'cancelar')
        const got = predict(sample.text, services, hasUpcoming)
        confusion.set(`${sample.label}>${got.label}`, (confusion.get(`${sample.label}>${got.label}`) ?? 0) + 1)
        if (got.label !== sample.label) failures.push({ sample, got: got.label })
        if ((sample.label === 'agendar' || sample.label === 'misto') && sample.service !== undefined && got.label === sample.label) {
          serviceChecked += 1
          const want = sample.service === null ? null : (idByName.get(sample.service) ?? null)
          if (got.serviceId === want) serviceOk += 1
          else failures.push({ sample, got: `serviço ${got.serviceId ?? 'nenhum'} (esperado ${sample.service ?? 'nenhum'})` })
        }
      }
      const lines: string[] = ['', `Intenção léxica: ${INTENT_CORPUS.length} frases`]
      for (const label of LABELS) {
        const tp = confusion.get(`${label}>${label}`) ?? 0
        const predicted = LABELS.reduce((n, l) => n + (confusion.get(`${l}>${label}`) ?? 0), 0)
        const actual = LABELS.reduce((n, l) => n + (confusion.get(`${label}>${l}`) ?? 0), 0)
        const p = predicted ? ((100 * tp) / predicted).toFixed(0) : '—'
        const r = actual ? ((100 * tp) / actual).toFixed(0) : '—'
        lines.push(`  ${label.padEnd(12)} precisão ${p}%  recall ${r}%  (n=${actual})`)
      }
      const agenda = INTENT_CORPUS.filter((x) => isAgendaLabel(x.label))
      const agendaHit = agenda.filter((x) => {
        const g = predict(x.text, services, x.upcoming ?? (x.label === 'remarcar' || x.label === 'cancelar'))
        return isAgendaLabel(g.label)
      }).length
      const info = INTENT_CORPUS.filter((x) => !isAgendaLabel(x.label))
      const infoFalse = info.filter((x) => isAgendaLabel(predict(x.text, services, true).label)).length
      lines.push(
        `  recall de «há intenção de agenda»: ${((100 * agendaHit) / agenda.length).toFixed(0)}% (${agendaHit}/${agenda.length})`,
        `  não-agenda tratada como agenda:    ${((100 * infoFalse) / info.length).toFixed(0)}% (${infoFalse}/${info.length})`,
        `  serviço pré-escolhido certo:       ${serviceChecked ? ((100 * serviceOk) / serviceChecked).toFixed(0) : '—'}% (${serviceOk}/${serviceChecked})`,
        '  Falhas:',
        ...failures.map((f) => `    [${f.sample.kind}] «${f.sample.text}» → ${f.got} (esperado ${f.sample.label})`),
      )
      console.log(lines.join('\n'))
      expect(failures.length).toBeLessThan(INTENT_CORPUS.length)
    } finally {
      s.close()
    }
  })
})
