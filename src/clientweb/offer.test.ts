import { describe, expect, it } from 'vitest'
import { hubOpeningBody } from './hub'
import {
  clientWebMyAppointmentsBody,
  clientWebOfferBody,
  clientWebOfferInteractive,
  clientWebUrl,
  CLIENT_WEB_MY_APPOINTMENTS_BODY,
  CLIENT_WEB_MY_APPOINTMENTS_NONE_BODY,
  CLIENT_WEB_OFFER_SENTENCE,
  isHttpsBase,
  isOpenAgendaButtonTitle,
  isWebScheduleIntentExemptFromLinkLimit,
  looksLikeClosingAssistOutbound,
  openAgendaReplyButton,
  OPEN_AGENDA_REPLY_BUTTON_ID,
  parseOpenAgendaReplyButton,
} from './offer'

describe('oferta do link no chat', () => {
  it('remarcar/cancelar (e noUpcoming) ficam isentos do teto de links', () => {
    expect(isWebScheduleIntentExemptFromLinkLimit({ purpose: 'remarcar' })).toBe(true)
    expect(isWebScheduleIntentExemptFromLinkLimit({ purpose: 'cancelar' })).toBe(true)
    expect(isWebScheduleIntentExemptFromLinkLimit({ purpose: 'agendar', noUpcoming: true })).toBe(true)
    expect(isWebScheduleIntentExemptFromLinkLimit({ purpose: 'agendar' })).toBe(false)
    expect(isWebScheduleIntentExemptFromLinkLimit({ purpose: 'home' })).toBe(false)
  })

  it('detecta inbound que é só o título «Abrir agenda»', () => {
    expect(isOpenAgendaButtonTitle('Abrir agenda')).toBe(true)
    expect(isOpenAgendaButtonTitle('  abrir agenda  ')).toBe(true)
    expect(isOpenAgendaButtonTitle('[Botão] Abrir agenda')).toBe(false)
    expect(isOpenAgendaButtonTitle('Quero Abrir agenda agora')).toBe(false)
  })

  it('detecta fecho do redator (TRE-82) para preferir cta_url', () => {
    expect(
      looksLikeClosingAssistOutbound(
        'Tudo bem, então! Se tiver qualquer dúvida depois, é só escrever aqui.',
      ),
    ).toBe(true)
    expect(
      looksLikeClosingAssistOutbound(
        'Por nada! Fico à disposição sempre que precisar. Tenha um ótimo fim de semana!',
      ),
    ).toBe(true)
    expect(looksLikeClosingAssistOutbound('Quem atende: Gi.')).toBe(false)
    expect(looksLikeClosingAssistOutbound('Funcionamos assim:\nseg–sex 9–18')).toBe(false)
  })

  it('reply «Abrir agenda» (DEC-216) e parse do serviço opcional', () => {
    expect(openAgendaReplyButton()).toEqual({ id: OPEN_AGENDA_REPLY_BUTTON_ID, title: 'Abrir agenda' })
    expect(openAgendaReplyButton('svc_dep')).toEqual({
      id: 'cw:abrir-agenda:svc_dep',
      title: 'Abrir agenda',
    })
    expect(parseOpenAgendaReplyButton(OPEN_AGENDA_REPLY_BUTTON_ID)).toEqual({ serviceId: null })
    expect(parseOpenAgendaReplyButton('cw:abrir-agenda:svc_dep')).toEqual({ serviceId: 'svc_dep' })
    expect(parseOpenAgendaReplyButton('handoff:human')).toBeNull()
  })

  it('troca a pergunta aberta do hub pela indicação do botão e mantém o expediente', () => {
    const hub = hubOpeningBody('Clínica Aurora', { opensAt: '09:00', closesAt: '18:00' })
    const body = clientWebOfferBody(hub)
    expect(body).toBe(`Olá! Aqui é a Clínica Aurora. Hoje funcionamos das 09:00 às 18:00. ${CLIENT_WEB_OFFER_SENTENCE}`)
    expect(body).not.toMatch(/O que você precisa\?/)
    expect(body.length).toBeLessThanOrEqual(1024)
  })
  it('sem corpo do hub usa uma abertura mínima', () => {
    expect(clientWebOfferBody(undefined)).toBe(`Olá! ${CLIENT_WEB_OFFER_SENTENCE}`)
    expect(clientWebOfferBody('  ')).toBe(`Olá! ${CLIENT_WEB_OFFER_SENTENCE}`)
  })
  it('monta o URL sem barra a mais e só aceita base https', () => {
    expect(clientWebUrl('https://app.tredane.com/', 'cw1_abc')).toBe('https://app.tredane.com/c/cw1_abc')
    expect(isHttpsBase('https://app.tredane.com')).toBe(true)
    expect(isHttpsBase('http://localhost:5173')).toBe(false)
    expect(isHttpsBase(undefined)).toBe(false)
  })
  it('o botão é «Abrir agenda» e cabe nos 20 caracteres da Meta', () => {
    const i = clientWebOfferInteractive('https://x.test/c/t')
    expect(i.ctaUrl?.displayText).toBe('Abrir agenda')
    expect(i.ctaUrl!.displayText.length).toBeLessThanOrEqual(20)
  })
  it('«meus agendamentos» aponta para a página, sem listar horários (TRE-74)', () => {
    expect(clientWebMyAppointmentsBody(true)).toBe(CLIENT_WEB_MY_APPOINTMENTS_BODY)
    expect(clientWebMyAppointmentsBody(false)).toBe(CLIENT_WEB_MY_APPOINTMENTS_NONE_BODY)
    expect(CLIENT_WEB_MY_APPOINTMENTS_BODY).toMatch(/Abrir agenda/)
    expect(CLIENT_WEB_MY_APPOINTMENTS_BODY).not.toMatch(/é só pedir aqui/)
    expect(CLIENT_WEB_MY_APPOINTMENTS_NONE_BODY).not.toMatch(/é só pedir aqui/)
  })
})
