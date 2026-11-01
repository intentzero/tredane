/**
 * ~30 conversas fictícias multi-turno para avaliação da identificação do objecto de marcação.
 * Resultado esperado: selected | clarify | handoff. Sem PII real.
 */
import type { BookingHandoffReason, BookingMatchKind } from '../booking-object'
import type { BookingSessionHint } from '../booking-object'

export type EvalTurn = {
  /** Texto da cliente neste turno. */
  text: string
  /** Sessão após turnos anteriores (o harness actualiza). */
  sessionBefore?: BookingSessionHint | null
  /** Opções oferecidas pela clínica no turno anterior (keys). */
  offeredKeys?: string[] | null
  catalogDrift?: boolean
}

export type EvalFixture = {
  id: string
  title: string
  tags: string[]
  turns: EvalTurn[]
  /** Resultado esperado no último turno. */
  expect: {
    kind: BookingMatchKind
    serviceId?: string | null
    variantIds?: string[]
    handoffReason?: BookingHandoffReason
    /** Se clarify, a pergunta deve mencionar um destes trechos (case-insensitive). */
    questionIncludes?: string[]
  }
  /**
   * Classificação a priori da falha se o baseline antigo falhar:
   * catalog | interpretation | continuity | validation
   */
  failureClassIfMiss: 'catalog' | 'interpretation' | 'continuity' | 'validation'
}

export const BOOKING_OBJECT_FIXTURES: EvalFixture[] = [
  {
    id: 'E01',
    title: 'Serviço sem variantes — pedido completo',
    tags: ['sem-variantes', 'completo'],
    turns: [{ text: 'Quero limpeza de pele amanhã às 15h' }],
    expect: { kind: 'selected', serviceId: 'svc-limpeza', variantIds: [] },
    failureClassIfMiss: 'interpretation',
  },
  {
    id: 'E02',
    title: 'Serviço sem variantes — nome popular parcial',
    tags: ['sem-variantes', 'vago'],
    turns: [{ text: 'Quero marcar uma limpeza' }],
    expect: {
      kind: 'clarify',
      serviceId: 'svc-limpeza',
      questionIncludes: ['limpeza', 'serviço', 'confirma'],
    },
    failureClassIfMiss: 'interpretation',
  },
  {
    id: 'E03',
    title: 'Pedido vago sem serviço',
    tags: ['vago'],
    turns: [{ text: 'Quero agendar um horário' }],
    expect: { kind: 'clarify', questionIncludes: ['serviço'] },
    failureClassIfMiss: 'interpretation',
  },
  {
    id: 'E04',
    title: 'Serviço inexistente',
    tags: ['inexistente'],
    turns: [{ text: 'Quero marcar bronzeamento artificial' }],
    expect: { kind: 'handoff', handoffReason: 'inexistente' },
    failureClassIfMiss: 'catalog',
  },
  {
    id: 'E05',
    title: 'Depilação com variantes — só o serviço',
    tags: ['com-variantes'],
    turns: [{ text: 'Quero depilação' }],
    expect: {
      kind: 'clarify',
      serviceId: 'svc-depilacao',
      questionIncludes: ['feminina', 'masculina'],
    },
    failureClassIfMiss: 'interpretation',
  },
  {
    id: 'E06',
    title: 'Depilação — linha depois zonas',
    tags: ['com-variantes', 'audiencia'],
    turns: [
      { text: 'Quero depilação' },
      {
        text: 'Feminina',
        sessionBefore: {
          serviceId: 'svc-depilacao',
          audienceLine: null,
          variantIds: null,
        },
      },
    ],
    expect: {
      kind: 'clarify',
      serviceId: 'svc-depilacao',
      questionIncludes: ['zona'],
    },
    failureClassIfMiss: 'continuity',
  },
  {
    id: 'E07',
    title: 'Depilação — axila e íntima feminina',
    tags: ['com-variantes', 'completo'],
    turns: [{ text: 'Quero depilação axila e intima feminina' }],
    expect: {
      kind: 'selected',
      serviceId: 'svc-depilacao',
      variantIds: ['z-axila-f', 'z-intima-f'],
    },
    failureClassIfMiss: 'interpretation',
  },
  {
    id: 'E08',
    title: 'Variantes por duração — laser uma hora',
    tags: ['duracao'],
    turns: [{ text: 'Quero laser facial o de uma hora' }],
    expect: {
      kind: 'selected',
      serviceId: 'svc-laser',
      variantIds: ['z-laser-60'],
    },
    failureClassIfMiss: 'interpretation',
  },
  {
    id: 'E09',
    title: 'Variantes por duração — meia hora',
    tags: ['duracao'],
    turns: [{ text: 'Laser facial de 30 min' }],
    expect: {
      kind: 'selected',
      serviceId: 'svc-laser',
      variantIds: ['z-laser-30'],
    },
    failureClassIfMiss: 'interpretation',
  },
  {
    id: 'E10',
    title: 'Laser sem duração — esclarece',
    tags: ['duracao', 'clarify'],
    turns: [{ text: 'Quero laser facial' }],
    expect: {
      kind: 'clarify',
      serviceId: 'svc-laser',
      questionIncludes: ['30', '60', 'sessão', 'h'],
    },
    failureClassIfMiss: 'interpretation',
  },
  {
    id: 'E11',
    title: 'Pergunta de preço durante selecção',
    tags: ['preco', 'continuidade'],
    turns: [
      {
        text: 'Quanto custa a axila?',
        sessionBefore: {
          serviceId: 'svc-depilacao',
          audienceLine: 'feminino',
          variantIds: null,
        },
      },
    ],
    expect: {
      kind: 'selected',
      serviceId: 'svc-depilacao',
      variantIds: ['z-axila-f'],
    },
    failureClassIfMiss: 'continuity',
  },
  {
    id: 'E12',
    title: 'Correção — troca de serviço',
    tags: ['correcao'],
    turns: [
      {
        text: 'Na verdade quero massagem',
        sessionBefore: {
          serviceId: 'svc-limpeza',
          audienceLine: null,
          variantIds: null,
        },
      },
    ],
    expect: { kind: 'selected', serviceId: 'svc-massagem', variantIds: [] },
    failureClassIfMiss: 'continuity',
  },
  {
    id: 'E13',
    title: 'Correção — troca de variante',
    tags: ['correcao', 'com-variantes'],
    turns: [
      {
        text: 'Melhor pernas em vez de axila',
        sessionBefore: {
          serviceId: 'svc-depilacao',
          audienceLine: 'feminino',
          variantIds: ['z-axila-f'],
        },
      },
    ],
    expect: {
      kind: 'selected',
      serviceId: 'svc-depilacao',
      variantIds: ['z-pernas-f'],
    },
    failureClassIfMiss: 'continuity',
  },
  {
    id: 'E14',
    title: 'Deíctico «esse» com oferta única',
    tags: ['deictico'],
    turns: [
      {
        text: 'Pode ser esse',
        offeredKeys: ['svc-design'],
      },
    ],
    expect: { kind: 'selected', serviceId: 'svc-design', variantIds: [] },
    failureClassIfMiss: 'continuity',
  },
  {
    id: 'E15',
    title: '«o de uma hora» sem nomear serviço — ambíguo',
    tags: ['deictico', 'duracao'],
    turns: [{ text: 'Quero o de uma hora' }],
    expect: { kind: 'clarify', questionIncludes: ['serviço'] },
    failureClassIfMiss: 'interpretation',
  },
  {
    id: 'E16',
    title: 'Igual à última vez — sem histórico',
    tags: ['historico'],
    turns: [{ text: 'Quero igual à última vez' }],
    expect: { kind: 'handoff', handoffReason: 'historico_indisponivel' },
    failureClassIfMiss: 'catalog',
  },
  {
    id: 'E17',
    title: 'Dois serviços no mesmo pedido',
    tags: ['multiplos'],
    turns: [{ text: 'Quero limpeza de pele e massagem amanhã' }],
    expect: { kind: 'handoff', handoffReason: 'multiplos_servicos' },
    failureClassIfMiss: 'validation',
  },
  {
    id: 'E18',
    title: 'Pedido para terceiro',
    tags: ['terceiro'],
    turns: [{ text: 'Quero marcar limpeza de pele pra minha mãe' }],
    expect: { kind: 'handoff', handoffReason: 'terceiro' },
    failureClassIfMiss: 'validation',
  },
  {
    id: 'E19',
    title: 'Catálogo mudou a meio',
    tags: ['catalogo'],
    turns: [
      {
        text: 'Pode ser axila',
        sessionBefore: {
          serviceId: 'svc-depilacao',
          audienceLine: 'feminino',
          variantIds: null,
        },
        catalogDrift: true,
      },
    ],
    expect: { kind: 'handoff', handoffReason: 'catalogo_vazio' },
    failureClassIfMiss: 'catalog',
  },
  {
    id: 'E20',
    title: 'Retoma após preço — zonas já na sessão',
    tags: ['preco', 'continuidade'],
    turns: [
      {
        text: 'Pode ser amanhã de manhã',
        sessionBefore: {
          serviceId: 'svc-depilacao',
          audienceLine: 'feminino',
          variantIds: ['z-axila-f', 'z-intima-f'],
        },
      },
    ],
    expect: {
      kind: 'selected',
      serviceId: 'svc-depilacao',
      variantIds: ['z-axila-f', 'z-intima-f'],
    },
    failureClassIfMiss: 'continuity',
  },
  {
    id: 'E21',
    title: 'Audiência masculina — peito',
    tags: ['audiencia'],
    turns: [{ text: 'Depilação masculina peito' }],
    expect: {
      kind: 'selected',
      serviceId: 'svc-depilacao',
      variantIds: ['z-peito-m'],
    },
    failureClassIfMiss: 'interpretation',
  },
  {
    id: 'E22',
    title: 'Buço (ambos) com linha feminina',
    tags: ['audiencia'],
    turns: [
      {
        text: 'Buço',
        sessionBefore: {
          serviceId: 'svc-depilacao',
          audienceLine: 'feminino',
          variantIds: null,
        },
      },
    ],
    expect: {
      kind: 'selected',
      serviceId: 'svc-depilacao',
      variantIds: ['z-buco'],
    },
    failureClassIfMiss: 'interpretation',
  },
  {
    id: 'E23',
    title: 'Design de sobrancelha — exacto',
    tags: ['sem-variantes'],
    turns: [{ text: 'Gostaria de design de sobrancelha' }],
    expect: { kind: 'selected', serviceId: 'svc-design', variantIds: [] },
    failureClassIfMiss: 'interpretation',
  },
  {
    id: 'E24',
    title: 'Massagem vs massagem relaxante — ambíguo parcial',
    tags: ['ambiguo'],
    turns: [{ text: 'Quero massagem' }],
    expect: {
      // «Massagem» exact casa o serviço Massagem; Massagem relaxante também contém a palavra
      // mas exact exige todas as palavras — Massagem ganha. Se ambos exact → handoff.
      kind: 'selected',
      serviceId: 'svc-massagem',
      variantIds: [],
    },
    failureClassIfMiss: 'interpretation',
  },
  {
    id: 'E25',
    title: 'Tudo na linha feminina',
    tags: ['com-variantes'],
    turns: [
      {
        text: 'Tudo',
        sessionBefore: {
          serviceId: 'svc-depilacao',
          audienceLine: 'feminino',
          variantIds: null,
        },
      },
    ],
    expect: {
      kind: 'selected',
      serviceId: 'svc-depilacao',
      variantIds: ['z-axila-f', 'z-intima-f', 'z-pernas-f', 'z-buco'],
    },
    failureClassIfMiss: 'continuity',
  },
  {
    id: 'E26',
    title: 'Hit parcial fraco não fecha',
    tags: ['parcial'],
    turns: [{ text: 'Quero algo de pele' }],
    expect: { kind: 'clarify', questionIncludes: ['serviço'] },
    failureClassIfMiss: 'interpretation',
  },
  {
    id: 'E27',
    title: 'Pedido completo laser 60 min',
    tags: ['completo', 'duracao'],
    turns: [{ text: 'Quero laser facial sessão longa' }],
    expect: {
      kind: 'selected',
      serviceId: 'svc-laser',
      variantIds: ['z-laser-60'],
    },
    failureClassIfMiss: 'interpretation',
  },
  {
    id: 'E28',
    title: 'Troca de linha (correcção)',
    tags: ['correcao', 'audiencia'],
    turns: [
      {
        text: 'Na verdade masculina',
        sessionBefore: {
          serviceId: 'svc-depilacao',
          audienceLine: 'feminino',
          variantIds: ['z-axila-f'],
        },
      },
    ],
    expect: {
      kind: 'clarify',
      serviceId: 'svc-depilacao',
      questionIncludes: ['zona', 'peito', 'axila'],
    },
    failureClassIfMiss: 'continuity',
  },
  {
    id: 'E29',
    title: 'Serviço + duração sem variantes (limpeza 60)',
    tags: ['duracao', 'sem-variantes'],
    turns: [{ text: 'Limpeza de pele de uma hora' }],
    expect: { kind: 'selected', serviceId: 'svc-limpeza', variantIds: [] },
    failureClassIfMiss: 'interpretation',
  },
  {
    id: 'E30',
    title: 'Deíctico sem oferta — não inventa',
    tags: ['deictico'],
    turns: [{ text: 'Pode ser esse' }],
    expect: { kind: 'clarify', questionIncludes: ['serviço'] },
    failureClassIfMiss: 'continuity',
  },
  {
    id: 'E31',
    title: 'Booking para amigo (terceiro)',
    tags: ['terceiro'],
    turns: [{ text: 'É pra minha amiga, massagem' }],
    expect: { kind: 'handoff', handoffReason: 'terceiro' },
    failureClassIfMiss: 'validation',
  },
  {
    id: 'E32',
    title: 'Pernas feminina já com linha na sessão',
    tags: ['continuidade'],
    turns: [
      {
        text: 'Pernas',
        sessionBefore: {
          serviceId: 'svc-depilacao',
          audienceLine: 'feminino',
          variantIds: null,
        },
      },
    ],
    expect: {
      kind: 'selected',
      serviceId: 'svc-depilacao',
      variantIds: ['z-pernas-f'],
    },
    failureClassIfMiss: 'continuity',
  },
]
