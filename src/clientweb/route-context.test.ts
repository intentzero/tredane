import { describe, expect, it } from 'vitest'
import { clientWebLinkFieldsFromText, clientWebSchedulePrefsFromText } from './route-context'
import type { ServiceRow } from '../clinic/config/types'

const depilacao: ServiceRow = {
  id: 'svc-dep',
  tenantId: 't',
  name: 'Depilação',
  active: true,
  audiencia: 'qualquer',
  variantSelection: 'varias',
  durationMinutes: 15,
  bufferMinutes: 0,
  priceCents: null,
  professionalIds: [],
  roomRequirement: { mode: 'none' },
  zones: [
    { id: 'z-f', name: 'Axila', audience: 'feminino', active: true, durationMinutes: 15, priceCents: 4000 },
    { id: 'z-m', name: 'Pernas', audience: 'masculino', active: true, durationMinutes: 30, priceCents: 14000 },
  ],
} as unknown as ServiceRow

describe('clientWebLinkFieldsFromText', () => {
  it('reconhece depilação masculina no pedido de vaga', () => {
    expect(
      clientWebLinkFieldsFromText('Ainda tem horário para fazer depilação masculina', 'svc-dep', [depilacao], '2026-11-18'),
    ).toEqual({
      audienceLine: 'masculino',
      variantIds: [],
      preferredDate: null,
      dayPart: null,
    })
  })

  it('rsamp fictício: amanhã de manhã no pedido de depilação', () => {
    expect(
      clientWebSchedulePrefsFromText(
        'Boa noite\nGostaria fazer uma depilação amanhã na parte da manhã?',
        '2026-11-18',
      ),
    ).toEqual({ preferredDate: '2026-11-19', dayPart: 'manha' })
    expect(
      clientWebLinkFieldsFromText(
        'Gostaria fazer uma depilação amanhã na parte da manhã?',
        'svc-dep',
        [depilacao],
        '2026-11-18',
      ).dayPart,
    ).toBe('manha')
  })
})