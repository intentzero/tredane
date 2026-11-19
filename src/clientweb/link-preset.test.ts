import { describe, expect, it } from 'vitest'
import { resolveClientWebLinkPreset } from './link-preset'
import type { ServiceRow } from '../clinic/config/types'

const depilacao: ServiceRow = {
  id: 'svc-dep',
  tenantId: 't',
  name: 'Depilação',
  active: true,
  audiencia: 'qualquer',
  variantSelection: 'varias',
  variantKind: 'zona',
  variantKindPlural: 'zonas',
  durationMinutes: 15,
  bufferMinutes: 0,
  priceCents: null,
  professionalIds: [],
  roomRequirement: { mode: 'none' },
  zones: [
    { id: 'z-f', name: 'Axila', audience: 'feminino', active: true, durationMinutes: 15, priceCents: 4000 },
    { id: 'z-m', name: 'Axila', audience: 'masculino', active: true, durationMinutes: 15, priceCents: 5000 },
  ],
} as unknown as ServiceRow

describe('resolveClientWebLinkPreset', () => {
  it('ignora serviço inactivo e linha incompatível sem falhar', () => {
    expect(resolveClientWebLinkPreset([depilacao], { serviceId: 'svc-x', audienceLine: 'masculino' })).toEqual({
      serviceId: null,
      audienceLine: null,
      variantIds: [],
      preferredDate: null,
      dayPart: null,
    })
  })

  it('mantém linha e só zonas válidas para o serviço', () => {
    expect(
      resolveClientWebLinkPreset([depilacao], {
        serviceId: 'svc-dep',
        audienceLine: 'masculino',
        variantIds: ['z-m', 'z-outra'],
      }),
    ).toEqual({
      serviceId: 'svc-dep',
      audienceLine: 'masculino',
      variantIds: ['z-m'],
      preferredDate: null,
      dayPart: null,
    })
  })
})