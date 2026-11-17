import { describe, expect, it } from 'vitest'
import { hubOpeningBody } from './hub'
import { clientWebOfferBody, clientWebOfferInteractive, clientWebUrl, CLIENT_WEB_OFFER_SENTENCE, isHttpsBase } from './offer'

describe('oferta do link no chat', () => {
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
})
