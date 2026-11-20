import { describe, expect, it } from 'vitest'
import {
  isLocationMapOfferReply,
  LOCATION_MAP_CTA_BODY,
  LOCATION_MAP_OFFER_BODIES,
  locationMapCtaInteractive,
  locationMapOfferButtons,
  OPEN_MAP_CTA_TEXT,
  OPEN_MAP_REPLY_BUTTON_ID,
  openMapReplyButton,
  parseOpenMapReplyButton,
} from './location-map-offer'
import type { Clock } from '../../db/clock'
import { OPEN_AGENDA_REPLY_BUTTON_ID } from '../../clientweb/offer'
import type { ClinicDb } from '../store'
import { HUMAN_HANDOFF_BUTTON_ID } from './human-handoff'

const db = {} as ClinicDb
const clock = { nowMs: () => 0 } as Clock

describe('oferta Abrir mapa (opção B)', () => {
  it('detecta o corpo sem URL e rejeita o formato antigo com link', () => {
    for (const body of LOCATION_MAP_OFFER_BODIES) {
      expect(isLocationMapOfferReply(body)).toBe(true)
    }
    expect(isLocationMapOfferReply('Estamos aqui: https://maps.app.goo.gl/x')).toBe(false)
    expect(isLocationMapOfferReply('Funcionamos das 09:00 às 18:00.')).toBe(false)
  })

  it('reply Abrir mapa + Agenda + Equipe (máx. 3) e CTA ≤ 20 chars', () => {
    expect(openMapReplyButton()).toEqual({ id: OPEN_MAP_REPLY_BUTTON_ID, title: OPEN_MAP_CTA_TEXT })
    expect(OPEN_MAP_CTA_TEXT.length).toBeLessThanOrEqual(20)
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
    const cta = locationMapCtaInteractive('https://maps.app.goo.gl/demo')
    expect(cta.ctaUrl).toEqual({ displayText: OPEN_MAP_CTA_TEXT, url: 'https://maps.app.goo.gl/demo' })
    expect(LOCATION_MAP_CTA_BODY).toMatch(/Abrir mapa/)
  })
})
