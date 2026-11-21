import { describe, expect, it } from 'vitest'
import { CLIENT_WEB_LINKS_PER_CONVERSATION } from '../../clientweb/offer'
import { runDialogCase } from './evals/dialogs/runner'
import { withOneAppointment } from './evals/dialogs/gu-cases'

describe('limite de links por conversa (DEC-202)', () => {
  it('depois de 5 links na hora o chat passa à equipe em vez de repetir o botão', async () => {
    const turns = Array.from({ length: CLIENT_WEB_LINKS_PER_CONVERSATION + 2 }, () => ({
      role: 'client' as const,
      text: 'Quero marcar',
    }))
    const r = await runDialogCase({ id: 'LIMIT', title: 'limite de links', turnosIdeais: 7, turns })
    const links = r.outbound.filter((b) => /toque em «Abrir agenda»/.test(b))
    expect(links).toHaveLength(CLIENT_WEB_LINKS_PER_CONVERSATION)
    expect(r.appointments).toBe(0)
    // O 6.º pedido passa à equipe; o 7.º já não recebe nada automático.
    expect(r.outbound.length).toBe(CLIENT_WEB_LINKS_PER_CONVERSATION + 1)
  })

  it('depois do teto, remarcar ainda envia Abrir agenda sem pausar (DEC-202)', async () => {
    // GU-30 no scorecard L1 cobre o mesmo caminho com prepare que simula o teto.
    const r = await runDialogCase({
      id: 'LIMIT-REMARCA',
      title: 'teto não bloqueia remarcar',
      turnosIdeais: 1,
      prepare: (s) => {
        withOneAppointment(s)
        const now = s.clock.nowMs()
        for (let i = 0; i < CLIENT_WEB_LINKS_PER_CONVERSATION; i++) {
          const messageId = `msg_limit_remarca_${i}`
          const createdAt = now - 60_000 + i
          s.db.run(
            `INSERT INTO messages (
              id, tenant_id, conversation_id, direction, body,
              external_message_id, delivery_state,
              author_clerk_user_id, author_display_name, created_at
            ) VALUES (?, ?, ?, 'outbound', ?, NULL, 'accepted', 'system:ai-autodraft', 'IA', ?)`,
            messageId,
            s.tenantId,
            s.conversationId,
            `Link prévio ${i + 1}`,
            createdAt,
          )
          s.db.run(
            `INSERT INTO outbound_messages (
              id, tenant_id, conversation_id, message_id, client_request_id,
              provider_message_id, kind, template_name, template_language,
              template_params_json, interactive_json, delivery_state, failure_reason, outbox_event_id,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, NULL, 'interactive', NULL, NULL, NULL, ?, 'accepted', NULL, NULL, ?, ?)`,
            `ob_limit_remarca_${i}`,
            s.tenantId,
            s.conversationId,
            messageId,
            `ai-web-agendar:seed_${i}`,
            JSON.stringify({
              ctaUrl: { displayText: 'Abrir agenda', url: `https://app.l1.test/c/seed${i}` },
            }),
            createdAt,
            createdAt,
          )
        }
      },
      turns: [{ role: 'client', text: 'Quero remarcar o meu agendamento' }],
      expect: {
        appointments: 1,
        notPaused: true,
        outboundIncludes: ['Para remarcar', 'Abrir agenda'],
        outboundExcludes: [/Vou pedir para a equipe/i],
        assert: (s) => {
          const row = s.db.get<{ interactive_json: string | null }>(
            `SELECT o.interactive_json AS interactive_json
             FROM outbound_messages o
             JOIN messages m ON m.id = o.message_id
             WHERE o.tenant_id = ? AND m.conversation_id = ?
               AND o.client_request_id LIKE 'ai-web-remarcar:%'
             ORDER BY o.created_at DESC LIMIT 1`,
            s.tenantId,
            s.conversationId,
          )
          if (!row?.interactive_json?.includes('cw:abrir-agenda')) {
            return [`esperava reply Abrir agenda, veio ${row?.interactive_json ?? 'null'}`]
          }
          return []
        },
      },
    })
    expect(r.ok).toBe(true)
    expect(r.error).toBeUndefined()
  })
})
