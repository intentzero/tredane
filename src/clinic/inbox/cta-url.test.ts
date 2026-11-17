import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { ingestContactMessage, workerCaller } from '../index'
import { ValidationError } from '../errors'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { seedSyntheticWhatsappTemplates } from './templates'
import { applyOutboundSendResultOp, sendOutboundMessageOp } from './operations'
import { findOutboundByClientRequestId } from './outbound'
import { createMetaAdapter } from '../../whatsapp/meta'

const URL_OK = 'https://app.tredane.test/c/cw1_exemplo'

function setup() {
  const clock = createControllableClock(Date.UTC(2026, 10, 17, 15))
  const { db, close } = bootClinicDb({ clock })
  const caller = workerCaller('clinic-demo-a', 'system:ai-autodraft')
  syncWhatsappChannel(
    db,
    'clinic-demo-a',
    { status: 'connected', bindingId: 'b1', phoneNumberId: 'pn1', wabaId: 'w1', displayPhone: '+1555', action: 'channel_connected' },
    clock,
  )
  seedSyntheticWhatsappTemplates(db, 'clinic-demo-a', clock)
  const ingested = ingestContactMessage(
    db,
    caller,
    { providerEventKey: 'wa:cta:1', waId: '5511987001888', body: 'quero agendar' },
    clock,
  )
  const send = (interactive: Parameters<typeof sendOutboundMessageOp>[2]['interactive'], key = 'cta-1', body = 'Abra a agenda para escolher o horário.') =>
    sendOutboundMessageOp(
      db,
      caller,
      {
        conversationId: ingested.conversation!.id,
        body,
        interactive,
        clientRequestId: key,
        authorClerkUserId: 'system:ai-autodraft',
        authorDisplayName: 'Assistente',
      },
      clock,
    )
  return { db, close, send }
}

describe('botão de URL (cta_url) — ADR-0018', () => {
  it('guarda o botão e leva-o no payload do outbox', () => {
    const { db, close, send } = setup()
    try {
      const sent = send({ ctaUrl: { displayText: 'Abrir agenda', url: URL_OK } })
      const ob = sent.outbox.find((o) => o.type === 'whatsapp.send')
      const payload = JSON.parse(ob!.payloadJson) as {
        kind: string
        interactiveCtaUrl: { displayText: string; url: string }
      }
      expect(payload.kind).toBe('interactive')
      expect(payload.interactiveCtaUrl).toEqual({ displayText: 'Abrir agenda', url: URL_OK })
      const row = findOutboundByClientRequestId(db, 'clinic-demo-a', 'cta-1')
      expect(row?.interactiveCtaUrl).toEqual({ displayText: 'Abrir agenda', url: URL_OK })
      expect(row?.interactiveButtons).toBeNull()
    } finally {
      close()
    }
  })

  it('recusa texto longo, URL não https e mistura com botões', () => {
    const { close, send } = setup()
    try {
      expect(() => send({ ctaUrl: { displayText: 'x'.repeat(21), url: URL_OK } }, 'k1')).toThrow(ValidationError)
      expect(() => send({ ctaUrl: { displayText: 'Abrir', url: 'http://inseguro.test/c/x' } }, 'k2')).toThrow(ValidationError)
      expect(() => send({ ctaUrl: { displayText: 'Abrir', url: 'não é url' } }, 'k3')).toThrow(ValidationError)
      expect(() =>
        send({ ctaUrl: { displayText: 'Abrir', url: URL_OK }, buttons: [{ id: 'a', title: 'A' }] }, 'k4'),
      ).toThrow(ValidationError)
    } finally {
      close()
    }
  })

  it('o adaptador sintético aceita https e recusa o resto', async () => {
    const meta = createMetaAdapter({ META_MODE: 'synthetic' } as never)
    const base = { phoneNumberId: 'pn1', accessToken: 'tok', toWaId: '5511987001888', body: 'Oi' }
    const ok = await meta.sendInteractiveCtaUrlMessage({ ...base, displayText: 'Abrir agenda', url: URL_OK })
    expect(ok.outcome).toBe('succeeded')
    const bad = await meta.sendInteractiveCtaUrlMessage({ ...base, displayText: 'Abrir agenda', url: 'http://x.test' })
    expect(bad).toEqual({ outcome: 'failed', errorCode: 'meta_interactive_cta_url_invalid' })
  })

  it('depois do envio o URL (com o token) sai do outbound e do outbox', () => {
    const { db, close, send } = setup()
    try {
      const caller = workerCaller('clinic-demo-a', 'system:ai-autodraft')
      const clock = createControllableClock(Date.UTC(2026, 10, 17, 16))
      const sent = send({ ctaUrl: { displayText: 'Abrir agenda', url: URL_OK } })
      const ob = sent.outbox.find((o) => o.type === 'whatsapp.send')!
      const outboxJson = () =>
        db.get<{ payload_json: string }>('SELECT payload_json FROM outbox_events WHERE id = ?', ob.id)!.payload_json
      const obRow = () => findOutboundByClientRequestId(db, 'clinic-demo-a', 'cta-1')

      expect(outboxJson()).toContain(URL_OK)
      expect(obRow()?.interactiveCtaUrl?.url).toBe(URL_OK)

      // Resultado incerto: o envio pode ser repetido, o outbox mantém o URL.
      applyOutboundSendResultOp(
        db,
        caller,
        { outboundId: obRow()!.id, outboxEventId: ob.id, idempotencyKey: ob.idempotencyKey, outcome: 'uncertain', errorCode: 'meta_adapter_error' },
        clock,
      )
      expect(outboxJson()).toContain(URL_OK)

      applyOutboundSendResultOp(
        db,
        caller,
        { outboundId: obRow()!.id, outboxEventId: ob.id, idempotencyKey: ob.idempotencyKey, outcome: 'succeeded', providerMessageId: 'wamid.X' },
        clock,
      )
      expect(outboxJson()).not.toContain(URL_OK)
      expect(outboxJson()).toContain('[removido]')
      expect(obRow()?.interactiveCtaUrl).toEqual({ displayText: 'Abrir agenda', url: '[removido]' })
      const dump = JSON.stringify([
        db.all('SELECT * FROM outbound_messages'),
        db.all('SELECT * FROM outbox_events'),
        db.all('SELECT * FROM messages'),
      ])
      expect(dump).not.toContain('cw1_exemplo')
    } finally {
      close()
    }
  })
})
