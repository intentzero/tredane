import { describe, expect, it } from 'vitest'
import {
  isGreetingOnly,
  isSlotTimePickByText,
  routeToClientWeb,
  servicesCitedInText,
  type RouteServiceHint,
} from './route-intent'

const services: RouteServiceHint[] = [
  { id: 'dep', name: 'Depilação', active: true, synonyms: ['depilar'], zones: [{ name: 'Axila', active: true }, { name: 'Pernas', active: true }] },
  { id: 'mas', name: 'Massagem', active: true, zones: [] },
  { id: 'masrel', name: 'Massagem relaxante', active: true, zones: [] },
  { id: 'lim', name: 'Limpeza de pele', active: true, zones: [] },
  { id: 'old', name: 'Peeling antigo', active: false, zones: [] },
]
const route = (text: string, hasUpcoming = false) => routeToClientWeb({ text, services, hasUpcoming })

describe('encaminhamento do chat para a página (DEC-202)', () => {
  it('marcar com serviço único reconhecido leva o serviço', () => {
    expect(route('Quero marcar massagem relaxante amanhã às 10h')).toEqual({ purpose: 'agendar', serviceId: 'masrel', noUpcoming: false })
    expect(route('quero agendar limpeza de pele')).toMatchObject({ purpose: 'agendar', serviceId: 'lim' })
    expect(route('tem horário para depilação sexta?')).toMatchObject({ purpose: 'agendar', serviceId: 'dep' })
  })

  it('serviço pela zona, pelo sinónimo e com plural leve', () => {
    expect(route('quero marcar axilas')).toMatchObject({ purpose: 'agendar', serviceId: 'dep' })
    expect(route('quero depilar amanhã')).toMatchObject({ purpose: 'agendar', serviceId: 'dep' })
  })

  it('o nome curto contido no longo não conta como ambíguo', () => {
    expect(servicesCitedInText(services, 'massagem relaxante').map((s) => s.id)).toEqual(['masrel'])
    expect(servicesCitedInText(services, 'uma massagem').map((s) => s.id)).toEqual(['mas'])
  })

  it('pedido de marcar sem serviço único abre sem serviço', () => {
    expect(route('quero marcar')).toEqual({ purpose: 'agendar', serviceId: null, noUpcoming: false })
    expect(route('tem vaga amanhã?')).toMatchObject({ purpose: 'agendar', serviceId: null })
    expect(route('quero marcar massagem e depilação')).toMatchObject({ purpose: 'agendar', serviceId: null })
  })

  it('TRE-77: «pode me atender amanhã?» encaminha Abrir agenda sem pedir serviço', () => {
    expect(route('Você pode-me atender amanhã?')).toEqual({
      purpose: 'agendar',
      serviceId: null,
      noUpcoming: false,
    })
    expect(route('Você pode me atender esta tarde?')).toMatchObject({
      purpose: 'agendar',
      serviceId: null,
    })
    // FAQ pura de expediente (sem disponibilidade) não é pedido de marcar.
    expect(route('Vocês abrem amanhã?')).toBeNull()
  })

  it('DEC-220: «me mostra a agenda» / «ver a agenda» encaminha (não cai no LLM)', () => {
    expect(route('Me mostra a agenda novamente')).toEqual({
      purpose: 'agendar',
      serviceId: null,
      noUpcoming: false,
    })
    expect(route('quero ver a agenda')).toMatchObject({ purpose: 'agendar', serviceId: null })
    expect(route('mostrar agenda')).toMatchObject({ purpose: 'agendar' })
  })

  it('serviço inativo não é reconhecido', () => {
    expect(route('quero marcar peeling antigo')).toMatchObject({ purpose: 'agendar', serviceId: null })
  })

  it('remarcar e cancelar dependem de haver marcação futura', () => {
    expect(route('quero remarcar', true)).toEqual({ purpose: 'remarcar', serviceId: null, noUpcoming: false })
    expect(route('preciso cancelar minha marcação', true)).toEqual({ purpose: 'cancelar', serviceId: null, noUpcoming: false })
    expect(route('quero remarcar', false)).toEqual({ purpose: 'agendar', serviceId: null, noUpcoming: true })
    expect(route('quero cancelar', false)).toEqual({ purpose: 'agendar', serviceId: null, noUpcoming: true })
  })

  it('erros de escrita do cancelar e do remarcar não viram pedido de agendar', () => {
    expect(route('quero cancelra meu agendamento', true)).toMatchObject({ purpose: 'cancelar' })
    expect(route('queria reagendra a depilação', true)).toMatchObject({ purpose: 'remarcar' })
    expect(route('quero cancelra meu agendamento', false)).toMatchObject({ purpose: 'agendar', noUpcoming: true })
  })

  it('perguntas de informação não são pedido de marcar', () => {
    expect(route('quanto custa a massagem?')).toBeNull()
    expect(route('quanto tempo dura a limpeza de pele?')).toBeNull()
    expect(route('o que é peeling?')).toBeNull()
    expect(route('onde fica a clínica?')).toBeNull()
    expect(route('vocês fazem botox?')).toBeNull()
  })

  it('pergunta condicional sobre cancelamento é política, não cancelamento', () => {
    expect(route('Se eu precisar cancelar, tem multa?', true)).toBeNull()
    expect(route('Se eu remarcar em cima da hora, cobram alguma coisa?', true)).toBeNull()
  })

  it('verbo explícito de cancelar/remarcar + termo de custo ainda encaminha (DEC-202)', () => {
    expect(route('quero cancelar, cobram?', true)).toEqual({
      purpose: 'cancelar',
      serviceId: null,
      noUpcoming: false,
    })
    expect(route('preciso cancelar minha marcação, tem multa?', true)).toEqual({
      purpose: 'cancelar',
      serviceId: null,
      noUpcoming: false,
    })
    expect(route('quero remarcar, cobram taxa?', true)).toEqual({
      purpose: 'remarcar',
      serviceId: null,
      noUpcoming: false,
    })
    expect(route('quero cancelar, cobram?', false)).toEqual({
      purpose: 'agendar',
      serviceId: null,
      noUpcoming: true,
    })
  })

  it('turno misto: marcar e perguntar informação no mesmo texto', () => {
    expect(route('quanto custa a limpeza de pele e tem horário amanhã?')).toMatchObject({
      purpose: 'agendar',
      serviceId: 'lim',
      mixed: true,
    })
    expect(route('quero marcar limpeza de pele')?.mixed).toBeUndefined()
    expect(route('quanto custa a limpeza de pele?')).toBeNull()
  })

  it('início do nome com duas palavras reconhece o serviço único', () => {
    const longo: RouteServiceHint[] = [{ id: 'prof', name: 'Limpeza de pele profunda', active: true, zones: [] }]
    expect(servicesCitedInText(longo, 'quanto custa a limpeza de pele?').map((s) => s.id)).toEqual(['prof'])
    expect(servicesCitedInText(longo, 'quero uma limpeza').map((s) => s.id)).toEqual([])
    const dois: RouteServiceHint[] = [...longo, { id: 'sup', name: 'Limpeza de pele suave', active: true, zones: [] }]
    expect(servicesCitedInText(dois, 'limpeza de pele').map((s) => s.id)).toEqual([])
  })

  it('erro de escrita de uma letra no nome longo ainda reconhece o serviço', () => {
    expect(servicesCitedInText(services, 'quero marcar depilaçao').map((s) => s.id)).toEqual(['dep'])
    expect(servicesCitedInText(services, 'quero marcar despilação').map((s) => s.id)).toEqual(['dep'])
  })

  it('cumprimento puro', () => {
    expect(isGreetingOnly('Oi')).toBe(true)
    expect(isGreetingOnly('bom dia, tudo bem?')).toBe(true)
    expect(isGreetingOnly('oi, quero marcar')).toBe(false)
  })

  it('TRE-60: «Boa tarde» + serviço nomeado não é WHEN (não encaminha a agendar)', () => {
    expect(route('Boa tarde, limpeza de pele')).toBeNull()
    expect(route('Boa noite, massagem')).toBeNull()
    expect(route('Boa tarde, limpeza de pele amanhã')).toMatchObject({
      purpose: 'agendar',
      serviceId: 'lim',
    })
  })

  it('DEC-202: aceite de hora por texto reencaminha (não cai no LLM)', () => {
    expect(isSlotTimePickByText('Pode ser as 10:15')).toBe(true)
    expect(isSlotTimePickByText('às 10:45')).toBe(true)
    expect(isSlotTimePickByText('10:15')).toBe(true)
    expect(isSlotTimePickByText('pode ser 10h15')).toBe(true)
    expect(isSlotTimePickByText('quanto custa às 10:15?')).toBe(false)
    expect(route('Pode ser as 10:15', true)).toEqual({
      purpose: 'remarcar',
      serviceId: null,
      noUpcoming: false,
    })
    expect(route('Pode ser as 10:15', false)).toEqual({
      purpose: 'agendar',
      serviceId: null,
      noUpcoming: false,
    })
    expect(route('10:15', true)).toMatchObject({ purpose: 'remarcar' })
  })
})
