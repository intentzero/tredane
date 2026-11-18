import { describe, expect, it } from 'vitest'
import { clientWebLinkFieldsFromText } from './route-context'
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
      clientWebLinkFieldsFromText('Ainda tem horário para fazer depilação masculina', 'svc-dep', [depilacao]),
    ).toEqual({ audienceLine: 'masculino', variantIds: [] })
  })
})