import { describe, expect, it } from 'vitest'
import {
  bodyContainsClinicMapsUrl,
  isLocationAsk,
  isLocationMapOfferReply,
  LOCATION_MAP_CTA_BODY,
  LOCATION_MAP_OFFER_BODIES,
  locationMapCtaInteractive,
  locationMapOfferButtons,
  locationMapOfferInteractive,
  OPEN_MAP_CTA_TEXT,
  OPEN_MAP_REPLY_BUTTON_ID,
  openMapReplyButton,
  parseOpenMapReplyButton,
  rewriteRawMapsUrlOutbound,
} from './location-map-offer'
import type { Clock } from '../../db/clock'
import { OPEN_AGENDA_REPLY_BUTTON_ID } from '../../clientweb/offer'
import type { ClinicDb } from '../store'
import { HUMAN_HANDOFF_BUTTON_ID } from './human-handoff'

const db = {} as ClinicDb
const clock = { nowMs: () => 0 } as Clock

describe('oferta Abrir mapa (opção B)', () => {
  it('reconhece paráfrases de localização sem confundir expediente', () => {
    expect(isLocationAsk('Onde fica a clínica?')).toBe(true)
    expect(isLocationAsk('Onde atendem?')).toBe(true)
    expect(isLocationAsk('onde vocês ficam?')).toBe(true)
    expect(isLocationAsk('onde é a clínica?')).toBe(true)
    expect(isLocationAsk('como chegar?')).toBe(true)
    expect(isLocationAsk('qual o endereço?')).toBe(true)
    expect(isLocationAsk('vocês atendem domingo?')).toBe(false)
    expect(isLocationAsk('Até que horas vocês atendem?')).toBe(false)
    expect(isLocationAsk('quem atende?')).toBe(false)
    expect(isLocationAsk('está atendendo hoje?')).toBe(false)
  })

  it('detecta o corpo sem URL e rejeita o formato antigo com link', () => {
    for (const body of LOCATION_MAP_OFFER_BODIES) {
      expect(isLocationMapOfferReply(body)).toBe(true)
    }
    expect(isLocationMapOfferReply('Estamos aqui: https://maps.app.goo.gl/x')).toBe(false)
    expect(isLocationMapOfferReply('Funcionamos das 09:00 às 18:00.')).toBe(false)
  })

  it('reescreve outbound que cola o URL cadastrado', () => {
    const link = 'https://maps.app.goo.gl/clinica-demo'
    expect(bodyContainsClinicMapsUrl(`Estamos aqui: ${link}`, link)).toBe(true)
    const out = rewriteRawMapsUrlOutbound(`Estamos aqui: ${link}`, 'cnv_x', link)
    expect(out.useMapButtons).toBe(true)
    expect(out.body).not.toMatch(/https?:\/\//i)
    expect(LOCATION_MAP_OFFER_BODIES).toContain(out.body)
    expect(rewriteRawMapsUrlOutbound('Sem link.', 'cnv_x', link).useMapButtons).toBe(false)
  })

  it('com URL https: 1.ª bolha só cta_url Abrir mapa (um toque)', () => {
    const link = 'https://maps.app.goo.gl/demo'
    expect(OPEN_MAP_CTA_TEXT.length).toBeLessThanOrEqual(20)
    const offer = locationMapOfferInteractive(link, db, 't', clock)
    expect(offer).toEqual(locationMapCtaInteractive(link))
    expect(offer.ctaUrl).toEqual({ displayText: OPEN_MAP_CTA_TEXT, url: link })
    expect(offer.buttons).toBeUndefined()
    expect(LOCATION_MAP_CTA_BODY).toMatch(/Abrir mapa/)
  })

  it('sem URL https: fallback reply Abrir mapa + Agenda + Equipe (máx. 3)', () => {
    expect(openMapReplyButton()).toEqual({ id: OPEN_MAP_REPLY_BUTTON_ID, title: OPEN_MAP_CTA_TEXT })
    expect(parseOpenMapReplyButton(OPEN_MAP_REPLY_BUTTON_ID)).toBe(true)
    expect(parseOpenMapReplyButton('cw:abrir-agenda')).toBe(false)
    expect(locationMapOfferButtons(db, 't', clock)).toEqual([
      { id: OPEN_MAP_REPLY_BUTTON_ID, title: OPEN_MAP_CTA_TEXT },
      { id: OPEN_AGENDA_REPLY_BUTTON_ID, title: 'Abrir agenda' },
      { id: HUMAN_HANDOFF_BUTTON_ID, title: 'Falar com a equipe' },
    ])
    expect(locationMapOfferButtons(db, 't', clock, { serviceId: 'svc_x' })[1]).toEqual({
      id: 'cw:abrir-agenda:svc_x',
      title: 'Abrir agenda',
    })
    expect(locationMapOfferInteractive('', db, 't', clock)).toEqual({
      buttons: locationMapOfferButtons(db, 't', clock),
    })
    expect(locationMapOfferInteractive('http://maps.example/x', db, 't', clock, { serviceId: 'svc_x' })).toEqual({
      buttons: locationMapOfferButtons(db, 't', clock, { serviceId: 'svc_x' }),
    })
  })
})
