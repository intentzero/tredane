/**
 * Catálogo fictício representativo para evals de identificação do objecto de marcação.
 * Sem PII. Nomes e preços inventados.
 */
import type { ServiceRow, ServiceZoneRow } from '../../config/types'

function zone(
  partial: Omit<ServiceZoneRow, 'tenantId' | 'active' | 'sortOrder'> & {
    active?: boolean
    sortOrder?: number
  },
): ServiceZoneRow {
  return {
    tenantId: 'eval-clinic',
    active: partial.active ?? true,
    sortOrder: partial.sortOrder ?? 0,
    ...partial,
  }
}

function service(
  partial: Pick<
    ServiceRow,
    'id' | 'name' | 'durationMinutes' | 'priceCents' | 'audiencia' | 'zones'
  > &
    Partial<Pick<ServiceRow, 'variantKind' | 'variantKindPlural' | 'active' | 'bufferMinutes'>>,
): ServiceRow {
  return {
    tenantId: 'eval-clinic',
    bufferMinutes: partial.bufferMinutes ?? 0,
    tempoCeu: 'tanto_faz',
    tempoTemperatura: 'tanto_faz',
    tempoCelsius: null,
    clientExplanation: null,
    active: partial.active ?? true,
    requiresSignal: false,
    signalKind: null,
    signalFixedCents: null,
    signalPercent: null,
    durationAdjustable: false,
    durationMinMinutes: null,
    durationMaxMinutes: null,
    createdAt: 0,
    updatedAt: 0,
    professionalIds: ['pro-eval'],
    roomRequirement: { mode: 'none' },
    equipmentResourceId: null,
    weeklyWindows: [],
    deletable: true,
    variantKind: partial.variantKind ?? null,
    variantKindPlural: partial.variantKindPlural ?? null,
    combos: [],
    ...partial,
  }
}

/** Catálogo: serviços com e sem variantes; duração e audiência. */
export const EVAL_BOOKING_CATALOG: ServiceRow[] = [
  service({
    id: 'svc-limpeza',
    name: 'Limpeza de pele',
    durationMinutes: 60,
    priceCents: 18000,
    audiencia: 'qualquer',
    zones: [],
  }),
  service({
    id: 'svc-limpeza-profunda',
    name: 'Limpeza de pele profunda',
    durationMinutes: 90,
    priceCents: 25000,
    audiencia: 'qualquer',
    zones: [],
  }),
  service({
    id: 'svc-massagem',
    name: 'Massagem',
    durationMinutes: 50,
    priceCents: 15000,
    audiencia: 'qualquer',
    zones: [],
  }),
  service({
    id: 'svc-massagem-60',
    name: 'Massagem relaxante',
    durationMinutes: 60,
    priceCents: 20000,
    audiencia: 'qualquer',
    zones: [],
  }),
  service({
    id: 'svc-depilacao',
    name: 'Depilação',
    durationMinutes: 30,
    priceCents: null,
    audiencia: 'qualquer',
    variantKind: 'Zona',
    variantKindPlural: 'Zonas',
    zones: [
      zone({
        id: 'z-axila-f',
        serviceId: 'svc-depilacao',
        name: 'Axila',
        durationMinutes: 15,
        priceCents: 4000,
        audience: 'feminino',
        sortOrder: 1,
      }),
      zone({
        id: 'z-intima-f',
        serviceId: 'svc-depilacao',
        name: 'Intima',
        durationMinutes: 20,
        priceCents: 15000,
        audience: 'feminino',
        sortOrder: 2,
      }),
      zone({
        id: 'z-pernas-f',
        serviceId: 'svc-depilacao',
        name: 'Pernas',
        durationMinutes: 40,
        priceCents: 12000,
        audience: 'feminino',
        sortOrder: 3,
      }),
      zone({
        id: 'z-axila-m',
        serviceId: 'svc-depilacao',
        name: 'Axila',
        durationMinutes: 15,
        priceCents: 4500,
        audience: 'masculino',
        sortOrder: 4,
      }),
      zone({
        id: 'z-peito-m',
        serviceId: 'svc-depilacao',
        name: 'Peito',
        durationMinutes: 30,
        priceCents: 9000,
        audience: 'masculino',
        sortOrder: 5,
      }),
      zone({
        id: 'z-buco',
        serviceId: 'svc-depilacao',
        name: 'Buço',
        durationMinutes: 10,
        priceCents: 3500,
        audience: 'ambos',
        sortOrder: 6,
      }),
    ],
  }),
  service({
    id: 'svc-design',
    name: 'Design de sobrancelha',
    durationMinutes: 30,
    priceCents: 8000,
    audiencia: 'feminino',
    zones: [],
  }),
  service({
    id: 'svc-laser',
    name: 'Laser facial',
    durationMinutes: 45,
    priceCents: null,
    audiencia: 'qualquer',
    variantKind: 'Sessão',
    variantKindPlural: 'Sessões',
    zones: [
      zone({
        id: 'z-laser-30',
        serviceId: 'svc-laser',
        name: 'Sessão curta',
        durationMinutes: 30,
        priceCents: 25000,
        audience: 'ambos',
        sortOrder: 1,
      }),
      zone({
        id: 'z-laser-60',
        serviceId: 'svc-laser',
        name: 'Sessão longa',
        durationMinutes: 60,
        priceCents: 40000,
        audience: 'ambos',
        sortOrder: 2,
      }),
    ],
  }),
]
