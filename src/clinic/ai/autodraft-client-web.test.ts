import { describe, expect, it } from 'vitest'
import { runDialogCase } from './evals/dialogs/runner'

describe('autodraft → link «Abrir agenda» com serviço e linha (DEC-202, D-20261118-084800-CUR)', () => {
  it('«Ainda tem horário para fazer depilação masculina»: frase fixa, link com Depilação masculino, sem horas do modelo', async () => {
    const r = await runDialogCase({
      id: 'CW-DEPIL-M',
      title: 'vaga com depilação masculina no texto',
      turnosIdeais: 1,
      turns: [{ role: 'client', text: 'Ainda tem horário para fazer depilação masculina' }],
      expect: {
        clientWebOffers: 1,
        clientWebPurposes: [{ purpose: 'agendar', serviceId: 'Depilação', audienceLine: 'masculino', variantIds: [] }],
        outboundIncludes: ['Para agendar Depilação', 'toque em «Abrir agenda»'],
        outboundExcludes: [/\d{1,2}:\d{2}/, /Horários/, /Confirma/],
        proposal: false,
        appointments: 0,
      },
    })
    expect(r.ok, r.expectErrors?.join('; ') ?? r.error).toBe(true)
  })

  it('P18 fictício: depilação amanhã de manhã leva data e período no link', async () => {
    const r = await runDialogCase({
      id: 'CW-RSAMP-P18',
      title: 'depilação amanhã na parte da manhã',
      nowMs: Date.UTC(2026, 10, 18, 22, 28),
      turnosIdeais: 1,
      turns: [{ role: 'client', text: 'Boa noite\nGostaria fazer uma depilação amanhã na parte da manhã?' }],
      expect: {
        clientWebOffers: 1,
        clientWebPurposes: [
          {
            purpose: 'agendar',
            serviceId: 'Depilação',
            preferredDate: '2026-11-19',
            dayPart: 'manha',
          },
        ],
        outboundIncludes: ['Para agendar Depilação', 'toque em «Abrir agenda»'],
        proposal: false,
        appointments: 0,
      },
    })
    expect(r.ok, r.expectErrors?.join('; ') ?? r.error).toBe(true)
  })
})