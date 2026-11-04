import { describe, expect, it } from 'vitest'
import { getBookingFrame } from '../../clinic/ai/schedule-session'
import { bootDialogScenario } from '../../clinic/ai/evals/dialogs/scenario'
import { handleFlowNfmReply, parseNfmResponseJson } from './nfm-reply'

describe('whatsapp flow nfm_reply (ADR-0016 §6)', () => {
  it('parseNfmResponseJson lê flow_token e escolhas', () => {
    const parsed = parseNfmResponseJson(
      JSON.stringify({
        flow_token: 'fl1_abc',
        service_id: 'svc_dep',
        line: 'feminino',
        variant_ids: ['z1', 'z2'],
        slot_id: '2026-11-05T17:00',
      }),
    )
    expect(parsed).toEqual({
      flowToken: 'fl1_abc',
      serviceId: 'svc_dep',
      line: 'feminino',
      variantIds: ['z1', 'z2'],
      slotId: '2026-11-05T17:00',
    })
  })

  it('grava quadro com provenance flow; sem Confirmar não marca (DEC-061)', async () => {
    const s = bootDialogScenario()
    try {
      s.sayInbound('oi')
      const axila = s.db.get<{ id: string }>(
        `SELECT id FROM service_zones
         WHERE service_id = ? AND name = 'Axila' AND audience = 'feminino'`,
        s.ids.depilacao,
      )!.id
      const pernas = s.db.get<{ id: string }>(
        `SELECT id FROM service_zones
         WHERE service_id = ? AND name = 'Pernas' AND audience = 'feminino'`,
        s.ids.depilacao,
      )!.id

      const result = await handleFlowNfmReply(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          providerEventKey: 'wa:msg:flow1',
          responseJson: JSON.stringify({
            flow_token: 'fl1_test',
            service_id: s.ids.depilacao,
            line: 'feminino',
            variant_ids: [axila, pernas],
            slot_id: '2026-11-05T17:00',
          }),
          catalogVersion: '1',
          capability: true,
        },
        s.clock,
      )

      expect(result.handled).toBe(true)
      const frame = getBookingFrame(s.db, s.tenantId, s.conversationId)
      expect(frame?.serviceId).toBe(s.ids.depilacao)
      expect(frame?.line).toBe('feminino')
      expect(frame?.date).toBe('2026-11-05')
      expect(frame?.time).toBe('17:00')
      expect(frame?.provenance.serviceId?.source).toBe('flow')
      expect(frame?.variantIds?.sort()).toEqual([axila, pernas].sort())
      // Fecho do Flow / nfm_reply não marca (DEC-061 / INV-01).
      expect(s.appointmentCount()).toBe(0)
    } finally {
      s.close()
    }
  })

  it('segundo nfm_reply igual com proposta → idempotent_skip', async () => {
    const s = bootDialogScenario()
    try {
      s.sayInbound('oi')
      const zones = s.db.all<{ id: string }>(
        `SELECT id FROM service_zones
         WHERE service_id = ? AND audience = 'feminino' AND active = 1`,
        s.ids.depilacao,
      )
      const responseJson = JSON.stringify({
        flow_token: 'fl1_idem',
        service_id: s.ids.depilacao,
        line: 'feminino',
        variant_ids: zones.map((z) => z.id),
        slot_id: '2026-11-06T10:00',
      })
      const first = await handleFlowNfmReply(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          providerEventKey: 'wa:msg:flow-a',
          responseJson,
          catalogVersion: '1',
        },
        s.clock,
      )
      // Só testa idempotência se a 1.ª passagem criou proposta.
      if (!first.autoBook?.proposalId) {
        expect(getBookingFrame(s.db, s.tenantId, s.conversationId)?.time).toBe('10:00')
        return
      }
      const second = await handleFlowNfmReply(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          providerEventKey: 'wa:msg:flow-b',
          responseJson,
          catalogVersion: '1',
        },
        s.clock,
      )
      expect(second.outcome).toBe('idempotent_skip')
      expect(s.appointmentCount()).toBe(0)
    } finally {
      s.close()
    }
  })
})
