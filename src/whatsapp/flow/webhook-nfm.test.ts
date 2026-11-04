import { describe, expect, it } from 'vitest'
import { parseWhatsappWebhookPayload } from '../webhook-parse'

describe('webhook parse nfm_reply (#514)', () => {
  it('reconhece nfm_reply com response_json', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: 'pn1' },
                contacts: [{ wa_id: '5511999999999', profile: { name: 'Ana' } }],
                messages: [
                  {
                    id: 'wamid.flow1',
                    from: '5511999999999',
                    timestamp: '1762347600',
                    type: 'interactive',
                    context: { id: 'wamid.flowmsg' },
                    interactive: {
                      type: 'nfm_reply',
                      nfm_reply: {
                        response_json: JSON.stringify({
                          flow_token: 'fl1_x',
                          service_id: 'svc',
                          slot_id: '2026-11-05T10:00',
                        }),
                        body: 'Sent',
                        name: 'flow',
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    }
    const parsed = parseWhatsappWebhookPayload(payload)
    expect(parsed.items).toHaveLength(1)
    const item = parsed.items[0]!
    expect(item.kind).toBe('nfm_reply')
    if (item.kind !== 'nfm_reply') return
    expect(item.responseJson).toContain('fl1_x')
    expect(item.contextMessageId).toBe('wamid.flowmsg')
  })
})
