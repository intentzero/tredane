/** Dados fictícios sintéticos para a prova M-04 / M-05 (DEC-041). Não usar em produção. */

export const contactName = 'Juliana Prado'

export const services = [
  { id: 'svc-laser', label: 'Depilação a laser — pernas', hint: '60 min · profissional habilitado + sala com laser' },
  { id: 'svc-limpeza', label: 'Limpeza de pele', hint: '45 min · profissional habilitado + sala de estética' },
  { id: 'svc-peeling', label: 'Peeling', hint: '30 min · profissional habilitado' },
] as const

export const professionals = [
  { id: 'any', label: 'Qualquer disponível' },
  { id: 'paula', label: 'Dra. Paula Reis' },
  { id: 'tiago', label: 'Dr. Tiago Nunes' },
] as const

export const days = [
  { id: '2026-10-29', weekday: 'qui', day: '29' },
  { id: '2026-10-30', weekday: 'sex', day: '30' },
  { id: '2026-10-31', weekday: 'sáb', day: '31' },
  { id: '2026-11-02', weekday: 'seg', day: '2' },
  { id: '2026-11-03', weekday: 'ter', day: '3' },
] as const

export const slots = [
  { id: '13:00', time: '13:00', resource: 'Dr. Tiago · Sala 2' },
  { id: '16:00', time: '16:00', resource: 'Dr. Tiago · Sala 2' },
  { id: '17:00', time: '17:00', resource: 'Dr. Tiago · Sala 2' },
] as const

export const defaultMessage =
  'Olá, Juliana! Seu horário está confirmado: sexta, 30/10, às 16:00, com Dr. Tiago Nunes.'

export const stages = [
  { id: 'novo', label: 'Novo', count: 1 },
  { id: 'atendimento', label: 'Em atendimento', count: 2 },
  { id: 'proposto', label: 'Horário proposto', count: 1 },
  { id: 'agendado', label: 'Agendado', count: 2 },
  { id: 'concluido', label: 'Concluído', count: 1 },
  { id: 'perdido', label: 'Perdido', count: 0 },
] as const

export const pipelineCards = [
  {
    id: 'beatriz',
    name: 'Beatriz Rocha',
    meta: 'Ana · há 1 h · Sem compromisso',
    fail: false,
  },
  {
    id: 'masked',
    name: '+55 11 9••••-0042',
    meta: 'Bruno · ontem',
    fail: true,
  },
] as const

export type MoveOption = {
  id: string
  label: string
  hint?: string
  hintWarn?: string
  highlight?: boolean
  danger?: boolean
}

export const moveOptions: MoveOption[] = [
  { id: 'novo', label: 'Novo contato' },
  {
    id: 'proposto',
    label: 'Horário proposto',
    hint: 'Não reserva horário na agenda',
    highlight: true,
  },
  {
    id: 'agendado',
    label: 'Agendado',
    hintWarn: 'Sem compromisso vinculado — agende depois',
  },
  { id: 'concluido', label: 'Concluído' },
  { id: 'perdido', label: 'Perdido', danger: true },
]

export type ServiceId = (typeof services)[number]['id']
export type ProfessionalId = (typeof professionals)[number]['id']
export type DayId = (typeof days)[number]['id']
export type SlotId = (typeof slots)[number]['id']
export type StageId = (typeof stages)[number]['id']
