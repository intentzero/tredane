/**
 * Corpus fixo da reexecução da sombra do interpretador (Proposto; ver
 * docs/architecture/hipotese-compreensao-llm-primeiro.md).
 *
 * Frases fictícias com a leitura correta **rotulada à mão**, sobre o catálogo
 * de referência (`EVAL_BOOKING_CATALOG`) e «hoje» = qui 05/11/2026. Serve para
 * medir, sem tráfego, o que o léxico, o validador de hoje e o modelo acertam,
 * falham ou inventam. Não é amostra de clientes reais: as frases são escritas
 * pela equipa e tendem a ser mais limpas do que as reais.
 *
 * O modelo é chamado pelo AI Gateway com a chave Anthropic guardada nele (BYOK, alias `staging`).
 */
import type { ShadowField, ShadowSlots } from '../../interpreter-shadow'

export const REPLAY_TODAY = '2026-11-05'

export type ReplayTag = 'literal' | 'coloquial' | 'typo' | 'hora' | 'data' | 'opcao' | 'sem_info'

export type ReplayPending = {
  slot: string
  options: Array<{ key: string; label: string }>
}

export type ReplayPhrase = {
  id: string
  text: string
  tag: ReplayTag
  /** Leitura correta. Campo ausente = a frase não o diz e nada deve ser preenchido. */
  expect: ShadowSlots
  /** Campos não avaliados (ambíguos ou irrelevantes para esta frase). */
  ignore?: ShadowField[]
  pending?: ReplayPending
}

const SLOTS_HORARIO: ReplayPending = {
  slot: 'horario',
  options: [
    { key: '2026-11-06T10:00', label: 'sex 06/11 10:00' },
    { key: '2026-11-06T14:00', label: 'sex 06/11 14:00' },
    { key: '2026-11-07T09:00', label: 'sáb 07/11 09:00' },
  ],
}

const SLOTS_VARIANTES: ReplayPending = {
  slot: 'variantes',
  options: [
    { key: 'z-axila-f', label: 'Axila' },
    { key: 'z-pernas-f', label: 'Pernas' },
    { key: 'z-buco', label: 'Buço' },
  ],
}

export const REPLAY_CORPUS: ReplayPhrase[] = [
  // — Nome do serviço citado: o caso fácil para o léxico —
  { id: 'L01', tag: 'literal', text: 'Quero limpeza de pele amanhã às 15h', expect: { service: 'svc-limpeza', date: '2026-11-06', time: '15:00' } },
  { id: 'L02', tag: 'literal', text: 'queria marcar massagem relaxante sábado de manhã', expect: { service: 'svc-massagem-60', date: '2026-11-07', period: 'manha' } },
  { id: 'L03', tag: 'literal', text: 'Depilação de axila feminina na segunda à tarde', expect: { service: 'svc-depilacao', variants: ['z-axila-f'], line: 'feminino', date: '2026-11-09', period: 'tarde' } },
  { id: 'L04', tag: 'literal', text: 'quero depilar buço e axila feminina', expect: { service: 'svc-depilacao', variants: ['z-axila-f', 'z-buco'], line: 'feminino' } },
  { id: 'L05', tag: 'literal', text: 'design de sobrancelha dia 10 às 9h30', expect: { service: 'svc-design', date: '2026-11-10', time: '09:30' } },
  { id: 'L06', tag: 'literal', text: 'laser facial sessão longa amanhã', expect: { service: 'svc-laser', variants: ['z-laser-60'], date: '2026-11-06' } },
  { id: 'L07', tag: 'literal', text: 'Quanto custa a massagem?', expect: { service: 'svc-massagem' } },
  { id: 'L08', tag: 'literal', text: 'depilação masculina peito', expect: { service: 'svc-depilacao', variants: ['z-peito-m'], line: 'masculino' } },
  { id: 'L09', tag: 'literal', text: 'quero massagem hoje às 16h', expect: { service: 'svc-massagem', date: '2026-11-05', time: '16:00' } },
  { id: 'L10', tag: 'literal', text: 'massagem dia 20/11 às 9h', expect: { service: 'svc-massagem', date: '2026-11-20', time: '09:00' } },
  { id: 'L11', tag: 'literal', text: 'limpeza de pele profunda na terça de manhã', expect: { service: 'svc-limpeza-profunda', date: '2026-11-10', period: 'manha' } },

  // — Linguagem coloquial sem o nome do catálogo —
  { id: 'C01', tag: 'coloquial', text: 'queria tirar os pelinhos do buço', expect: { service: 'svc-depilacao', variants: ['z-buco'] } },
  { id: 'C02', tag: 'coloquial', text: 'quero fazer a sobrancelha amanhã de tarde', expect: { service: 'svc-design', date: '2026-11-06', period: 'tarde' } },
  { id: 'C03', tag: 'coloquial', text: 'queria uma limpeza no rosto sexta', expect: { date: '2026-11-06' }, ignore: ['service'] },
  { id: 'C04', tag: 'coloquial', text: 'preciso depilar as pernas', expect: { service: 'svc-depilacao', variants: ['z-pernas-f'] }, ignore: ['line'] },
  { id: 'C05', tag: 'coloquial', text: 'quero fazer laser no rosto, a sessão mais curta', expect: { service: 'svc-laser', variants: ['z-laser-30'] } },
  { id: 'C06', tag: 'coloquial', text: 'tem horário pra massagem depois do almoço?', expect: { service: 'svc-massagem', period: 'tarde' } },
  { id: 'C07', tag: 'coloquial', text: 'queria relaxar as costas amanhã', expect: { date: '2026-11-06' }, ignore: ['service'] },
  { id: 'C08', tag: 'coloquial', text: 'me vê um horário de manhãzinha na terça', expect: { date: '2026-11-10', period: 'manha' } },
  { id: 'C09', tag: 'coloquial', text: 'queria tirar os pelos da axila, pode ser à noitinha?', expect: { service: 'svc-depilacao', variants: ['z-axila-f'], period: 'noite' }, ignore: ['line'] },
  { id: 'C10', tag: 'coloquial', text: 'quero ajeitar as sobrancelhas na sexta', expect: { service: 'svc-design', date: '2026-11-06' } },
  { id: 'C11', tag: 'coloquial', text: 'preciso de uma limpeza bem completa, a mais demorada', expect: { service: 'svc-limpeza-profunda' } },
  { id: 'C12', tag: 'coloquial', text: 'queria depilar o peito pro verão', expect: { service: 'svc-depilacao', variants: ['z-peito-m'] }, ignore: ['line'] },

  // — Horas, datas e períodos em linguagem natural —
  { id: 'H01', tag: 'hora', text: 'umas 3 da tarde tá bom', expect: { time: '15:00' }, ignore: ['period'] },
  { id: 'H02', tag: 'hora', text: 'meio-dia', expect: { time: '12:00' } },
  { id: 'H03', tag: 'hora', text: 'depois de amanhã de manhã', expect: { date: '2026-11-07', period: 'manha' } },
  { id: 'H04', tag: 'hora', text: 'semana que vem, segunda', expect: { date: '2026-11-09' } },
  { id: 'H05', tag: 'hora', text: 'dia 12 às 10', expect: { date: '2026-11-12', time: '10:00' } },
  { id: 'H06', tag: 'hora', text: 'tem vaga hoje?', expect: { date: '2026-11-05' } },
  { id: 'H07', tag: 'hora', text: 'só posso depois das 18h', expect: {}, ignore: ['time', 'period'] },
  { id: 'H08', tag: 'hora', text: 'quinta que vem às 14h', expect: { date: '2026-11-12', time: '14:00' } },
  { id: 'H09', tag: 'hora', text: 'fim de tarde no sábado', expect: { date: '2026-11-07', period: 'tarde' } },
  { id: 'H10', tag: 'hora', text: 'às 8 e meia da manhã', expect: { time: '08:30' }, ignore: ['period'] },

  // — Erros de escrita —
  { id: 'T01', tag: 'typo', text: 'masagem amanha as 14h', expect: { service: 'svc-massagem', date: '2026-11-06', time: '14:00' } },
  { id: 'T02', tag: 'typo', text: 'depilaçao axila feminina', expect: { service: 'svc-depilacao', variants: ['z-axila-f'], line: 'feminino' } },
  { id: 'T03', tag: 'typo', text: 'limpesa de pele profunda sabado', expect: { service: 'svc-limpeza-profunda', date: '2026-11-07' } },
  { id: 'T04', tag: 'typo', text: 'sobrancelha amanha 10h', expect: { service: 'svc-design', date: '2026-11-06', time: '10:00' } },
  { id: 'T05', tag: 'typo', text: 'laser facil sessao curta', expect: { service: 'svc-laser', variants: ['z-laser-30'] } },

  // — Sem informação de marcação: nada deve ser preenchido —
  { id: 'N01', tag: 'sem_info', text: 'oi', expect: {} },
  { id: 'N02', tag: 'sem_info', text: 'quero marcar', expect: {} },
  { id: 'N03', tag: 'sem_info', text: 'obrigada!', expect: {} },
  { id: 'N04', tag: 'sem_info', text: 'tudo bem?', expect: {} },
  { id: 'N05', tag: 'sem_info', text: 'vocês atendem aos domingos?', expect: {}, ignore: ['date'] },
  { id: 'N06', tag: 'sem_info', text: 'quero um tratamento', expect: {} },
  { id: 'N07', tag: 'sem_info', text: 'preciso falar com alguém', expect: {} },
  { id: 'N08', tag: 'sem_info', text: 'qual o endereço de vocês?', expect: {} },
  { id: 'N09', tag: 'sem_info', text: 'fazem pacote pra noivas?', expect: {} },
  { id: 'N10', tag: 'sem_info', text: 'vocês têm estacionamento?', expect: {} },

  // — Resposta à pergunta pendente (lista de horários) —
  { id: 'P01', tag: 'opcao', text: 'o das duas da tarde', pending: SLOTS_HORARIO, expect: { option: 1 }, ignore: ['time', 'period'] },
  { id: 'P02', tag: 'opcao', text: 'a primeira', pending: SLOTS_HORARIO, expect: { option: 0 } },
  { id: 'P03', tag: 'opcao', text: 'o de sábado', pending: SLOTS_HORARIO, expect: { option: 2 }, ignore: ['date'] },
  { id: 'P04', tag: 'opcao', text: 'pode ser esse último', pending: SLOTS_HORARIO, expect: { option: 2 } },
  { id: 'P05', tag: 'opcao', text: '14h', pending: SLOTS_HORARIO, expect: { option: 1 }, ignore: ['time'] },
  { id: 'P06', tag: 'opcao', text: 'nenhum serve, tem outro dia?', pending: SLOTS_HORARIO, expect: {} },
  { id: 'P07', tag: 'opcao', text: 'a segunda opção', pending: SLOTS_HORARIO, expect: { option: 1 } },
  { id: 'P08', tag: 'opcao', text: 'prefiro o das nove', pending: SLOTS_HORARIO, expect: { option: 2 }, ignore: ['time', 'period'] },

  // — Resposta à pergunta pendente (zonas) —
  { id: 'V01', tag: 'opcao', text: 'axila e pernas', pending: SLOTS_VARIANTES, expect: { service: 'svc-depilacao', variants: ['z-axila-f', 'z-pernas-f'] }, ignore: ['line', 'option'] },
  { id: 'V02', tag: 'opcao', text: 'só o buço', pending: SLOTS_VARIANTES, expect: { service: 'svc-depilacao', variants: ['z-buco'] }, ignore: ['option'] },
  { id: 'V03', tag: 'opcao', text: 'a primeira e a última', pending: SLOTS_VARIANTES, expect: { service: 'svc-depilacao', variants: ['z-axila-f', 'z-buco'] }, ignore: ['line', 'option'] },
]
