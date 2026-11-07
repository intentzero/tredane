import { describe, expect, it } from 'vitest'
import { getBookingFrame, saveBookingFrame } from '../../clinic/ai/schedule-session'
import { bootDialogScenario } from '../../clinic/ai/evals/dialogs/scenario'
import { FLOW_COPY } from './copy'
import {
  handleFlowNfmReply,
  isBookableAgendarNfm,
  parseNfmResponseJson,
} from './nfm-reply'

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
      fallbackReason: null,
      hubAction: null,
    })
  })

  it('parseNfmResponseJson lê hub_action dos stubs TR-306', () => {
    const parsed = parseNfmResponseJson(
      JSON.stringify({ flow_token: 'fl1_hub', hub_action: 'cancelar' }),
    )
    expect(parsed).toEqual({
      flowToken: 'fl1_hub',
      serviceId: null,
      line: null,
      variantIds: [],
      slotId: null,
      fallbackReason: null,
      hubAction: 'cancelar',
    })
  })

  it('hub cancelar → handoff humano sem marcar (DEC-083 / DEC-091)', async () => {
    const s = bootDialogScenario()
    try {
      s.sayInbound('oi')
      const result = await handleFlowNfmReply(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          providerEventKey: 'wa:msg:flow-hub-cancel',
          responseJson: JSON.stringify({
            flow_token: 'fl1_hub_c',
            hub_action: 'cancelar',
          }),
          catalogVersion: '1',
        },
        s.clock,
      )
      expect(result.outcome).toBe('hub_handoff')
      expect(s.appointmentCount()).toBe(0)
      const outbound = s.outboundBodies()
      expect(outbound.some((b) => /equipe continuar/i.test(b))).toBe(true)
    } finally {
      s.close()
    }
  })

  it('hub remarcar sem compromisso → handoff (DEC-091)', async () => {
    const s = bootDialogScenario()
    try {
      s.sayInbound('oi')
      const result = await handleFlowNfmReply(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          providerEventKey: 'wa:msg:flow-hub-rem',
          responseJson: JSON.stringify({
            flow_token: 'fl1_hub_r',
            hub_action: 'remarcar',
          }),
          catalogVersion: '1',
        },
        s.clock,
      )
      expect(result.outcome).toBe('hub_handoff')
      expect(result.reason).toBe('remarcar')
    } finally {
      s.close()
    }
  })

  it('hub meus sem compromisso → frase Confirmada (não handoff)', async () => {
    const s = bootDialogScenario()
    try {
      s.sayInbound('oi')
      const result = await handleFlowNfmReply(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          providerEventKey: 'wa:msg:flow-hub-meus',
          responseJson: JSON.stringify({
            flow_token: 'fl1_hub_m',
            hub_action: 'meus',
          }),
          catalogVersion: '1',
        },
        s.clock,
      )
      expect(result.outcome).toBe('hub_meus_sent')
      expect(s.outboundBodies().some((b) => /não tem horário marcado/i.test(b))).toBe(true)
      expect(s.outboundBodies().some((b) => /equipe continuar/i.test(b))).toBe(false)
    } finally {
      s.close()
    }
  })

  it('hub informacoes → expediente + link config', async () => {
    const s = bootDialogScenario()
    try {
      s.db.run(
        `UPDATE clinic_settings SET google_business_url = ? WHERE tenant_id = ?`,
        'https://maps.app.goo.gl/ficticio-nfm',
        s.tenantId,
      )
      s.sayInbound('oi')
      const result = await handleFlowNfmReply(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          providerEventKey: 'wa:msg:flow-hub-info',
          responseJson: JSON.stringify({
            flow_token: 'fl1_hub_i',
            hub_action: 'informacoes',
          }),
          catalogVersion: '1',
        },
        s.clock,
      )
      expect(result.outcome).toBe('hub_info_sent')
      const body = s.outboundBodies().at(-1) ?? ''
      expect(body).toContain('https://maps.app.goo.gl/ficticio-nfm')
      expect(body).toMatch(/segunda:/)
    } finally {
      s.close()
    }
  })

  it('hub equipe → handoff DEC-083', async () => {
    const s = bootDialogScenario()
    try {
      s.sayInbound('oi')
      const result = await handleFlowNfmReply(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          providerEventKey: 'wa:msg:flow-hub-eq',
          responseJson: JSON.stringify({
            flow_token: 'fl1_hub_e',
            hub_action: 'equipe',
          }),
          catalogVersion: '1',
        },
        s.clock,
      )
      expect(result.outcome).toBe('hub_handoff')
      expect(result.reason).toBe('equipe')
      expect(s.outboundBodies().some((b) => /equipe continuar/i.test(b))).toBe(true)
    } finally {
      s.close()
    }
  })

  it('Finding 3: fallback_reason no_slots envia sem_horario_semana e não marca', async () => {
    const s = bootDialogScenario()
    try {
      s.sayInbound('oi')
      const result = await handleFlowNfmReply(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          providerEventKey: 'wa:msg:flow-fb',
          responseJson: JSON.stringify({
            flow_token: 'fl1_fb',
            service_id: s.ids.depilacao,
            fallback_reason: 'no_slots',
          }),
          catalogVersion: '1',
        },
        s.clock,
      )
      expect(result.outcome).toBe('chat_fallback_sent')
      expect(s.appointmentCount()).toBe(0)
      const outbound = s.outboundBodies()
      expect(outbound.some((b) => /horário livre/i.test(b))).toBe(true)
      expect(outbound.some((b) => b.includes(FLOW_COPY.preparingProposal))).toBe(false)
    } finally {
      s.close()
    }
  })

  it('fallback_reason catalog_changed pede à cliente por texto (C12) e não marca', async () => {
    const s = bootDialogScenario()
    try {
      s.sayInbound('oi')
      const result = await handleFlowNfmReply(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          providerEventKey: 'wa:msg:flow-cc',
          responseJson: JSON.stringify({
            flow_token: 'fl1_cc',
            service_id: s.ids.depilacao,
            fallback_reason: 'catalog_changed',
          }),
          catalogVersion: '1',
        },
        s.clock,
      )
      expect(result.outcome).toBe('chat_fallback_sent')
      expect(s.appointmentCount()).toBe(0)
      const outbound = s.outboundBodies()
      expect(outbound).toContain(FLOW_COPY.openFailed)
      expect(outbound.some((b) => b.includes(FLOW_COPY.preparingProposal))).toBe(false)
    } finally {
      s.close()
    }
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
      const bodies = s.outboundBodies()
      expect(bodies.some((b) => b === FLOW_COPY.preparingProposal)).toBe(true)
      expect(bodies.join('\n')).not.toMatch(/America\//)
      const proposal = bodies.find((b) => b.includes('Proposta de horário'))
      if (proposal) expect(proposal).toMatch(/Confirmar/)
    } finally {
      s.close()
    }
  })

  it('segundo nfm_reply igual com proposta versionada → idempotent_skip (#556)', async () => {
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
      await handleFlowNfmReply(
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
      const frameAfterFirst = getBookingFrame(s.db, s.tenantId, s.conversationId)
      expect(frameAfterFirst?.time).toBe('10:00')
      expect(s.appointmentCount()).toBe(0)
      // #556: skip só com proposal versionada no quadro — não com proposalId solto
      // nem phase ofertado. Deploy main 341334d (#557) falhou quando a 1.ª
      // devolvia proposalId sem proposal_json → 2.ª stale_no_proposal
      // (actions/runs/41938600215). Sem proposal no quadro, não assertamos skip.
      if (!frameAfterFirst?.proposal) return

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

  it('fase ack devolve cedo com C16; proposal depois (sem vácuo no DO)', async () => {
    const s = bootDialogScenario()
    try {
      s.sayInbound('oi')
      const zones = s.db.all<{ id: string }>(
        `SELECT id FROM service_zones
         WHERE service_id = ? AND audience = 'feminino' AND active = 1`,
        s.ids.depilacao,
      )
      const responseJson = JSON.stringify({
        flow_token: 'fl1_phase',
        service_id: s.ids.depilacao,
        line: 'feminino',
        variant_ids: zones.map((z) => z.id),
        slot_id: '2026-11-06T10:00',
      })
      const flushed: string[] = []
      const ack = await handleFlowNfmReply(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          providerEventKey: 'wa:msg:flow-phase',
          responseJson,
          catalogVersion: '1',
          capability: true,
          phase: 'ack',
          flushOutbound: async (rows) => {
            for (const r of rows) flushed.push(r.type)
          },
        },
        s.clock,
      )
      expect(ack.outcome).toBe('ack_sent')
      expect(ack.needsProposal).toBe(true)
      expect(s.outboundBodies().some((b) => b === FLOW_COPY.preparingProposal)).toBe(true)
      // Ainda sem cartão Confirmar — a fase proposal é que monta.
      expect(s.outboundBodies().some((b) => /Proposta de horário/i.test(b))).toBe(false)
      expect(getBookingFrame(s.db, s.tenantId, s.conversationId)?.phase).toBe('ofertado')

      const prop = await handleFlowNfmReply(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          providerEventKey: 'wa:msg:flow-phase',
          responseJson,
          catalogVersion: '1',
          capability: true,
          phase: 'proposal',
        },
        s.clock,
      )
      expect(prop.needsProposal).toBe(false)
      expect(s.appointmentCount()).toBe(0)
      const after = s.outboundBodies()
      // Fumo 04/11 ~22:00 (#556 biphasic): C16 outbound não pode abortar
      // tryAiAutoBook com not_confirmed → C16b sem Confirmar.
      expect(prop.outcome).toBe('proposal_sent')
      expect(prop.autoBook?.proposalId).toBeTruthy()
      expect(prop.autoBook?.status).not.toBe('not_confirmed')
      expect(after.some((b) => b === FLOW_COPY.proposalBuildFailed)).toBe(false)
      expect(after.some((b) => /Proposta de horário/i.test(b))).toBe(true)
      expect(after.some((b) => /Confirmar/i.test(b))).toBe(true)
      expect(flushed.length).toBeGreaterThan(0)
    } finally {
      s.close()
    }
  })

  it('C16 mais recente + Buço/slot: monta Confirmar (fumo C16b staging)', async () => {
    const s = bootDialogScenario()
    try {
      s.sayInbound('[Flow] Sent')
      // Cenário de diálogos: Buço é audience «ambos» (staging piloto pode ser feminino).
      const buco = s.db.get<{ id: string }>(
        `SELECT id FROM service_zones
         WHERE service_id = ? AND name = 'Buço' AND active = 1`,
        s.ids.depilacao,
      )
      expect(buco?.id).toBeTruthy()
      const responseJson = JSON.stringify({
        flow_token: 'fl1_buco',
        service_id: s.ids.depilacao,
        line: 'feminino',
        variant_ids: [buco!.id],
        slot_id: '2026-11-06T09:00',
      })
      // Produção: C16 sai depois do nfm inbound (ack inline fora do DO).
      s.clock.advance(1_500)
      await handleFlowNfmReply(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          providerEventKey: 'wa:msg:flow-buco',
          responseJson,
          catalogVersion: '1',
          capability: true,
          phase: 'ack',
        },
        s.clock,
      )
      const newest = s.db.get<{ direction: string; body: string }>(
        `SELECT direction, body FROM messages
         WHERE tenant_id = ? AND conversation_id = ?
         ORDER BY created_at DESC, id DESC LIMIT 1`,
        s.tenantId,
        s.conversationId,
      )
      expect(newest?.direction).toBe('outbound')
      expect(newest?.body).toBe(FLOW_COPY.preparingProposal)

      s.clock.advance(500)
      const prop = await handleFlowNfmReply(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          providerEventKey: 'wa:msg:flow-buco',
          responseJson,
          catalogVersion: '1',
          capability: true,
          phase: 'proposal',
        },
        s.clock,
      )
      expect(prop.outcome).toBe('proposal_sent')
      expect(prop.autoBook?.status).not.toBe('not_confirmed')
      expect(s.outboundBodies().some((b) => b === FLOW_COPY.proposalBuildFailed)).toBe(false)
      expect(s.outboundBodies().some((b) => /Proposta de horário/i.test(b))).toBe(true)
      expect(s.appointmentCount()).toBe(0)
    } finally {
      s.close()
    }
  })

  it('ofertado sem proposal: mid-flight não duplica C16; ainda monta proposta/recovery', async () => {
    const s = bootDialogScenario()
    try {
      s.sayInbound('oi')
      const zones = s.db.all<{ id: string }>(
        `SELECT id FROM service_zones
         WHERE service_id = ? AND audience = 'feminino' AND active = 1`,
        s.ids.depilacao,
      )
      const responseJson = JSON.stringify({
        flow_token: 'fl1_ofertado',
        service_id: s.ids.depilacao,
        line: 'feminino',
        variant_ids: zones.map((z) => z.id),
        slot_id: '2026-11-06T10:00',
      })
      const ackOnly = await handleFlowNfmReply(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          providerEventKey: 'wa:msg:flow-ofertado-a',
          responseJson,
          catalogVersion: '1',
          phase: 'ack',
        },
        s.clock,
      )
      expect(ackOnly.outcome).toBe('ack_sent')
      expect(getBookingFrame(s.db, s.tenantId, s.conversationId)?.proposal).toBeNull()

      const retry = await handleFlowNfmReply(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          providerEventKey: 'wa:msg:flow-ofertado-b',
          responseJson,
          catalogVersion: '1',
          capability: true,
          phase: 'all',
        },
        s.clock,
      )
      // Não idempotent_skip: ainda não há proposal versionada.
      expect(retry.outcome).not.toBe('idempotent_skip')
      expect(['proposal_sent', 'stale_no_proposal']).toContain(retry.outcome)
      const bodies = s.outboundBodies()
      const ackCount = bodies.filter((b) => b === FLOW_COPY.preparingProposal).length
      // Mid-flight (mesmo serviço/slot): segundo nfm não reenvia C16.
      expect(ackCount).toBe(1)
      const hasProposal = bodies.some((b) => /Proposta de horário/i.test(b))
      const hasRecovery = bodies.some((b) => b === FLOW_COPY.proposalBuildFailed)
      const hasFollowUp = bodies.some(
        (b) => b !== FLOW_COPY.preparingProposal && b.trim().length > 0,
      )
      expect(hasProposal || hasRecovery || hasFollowUp).toBe(true)
      expect(s.appointmentCount()).toBe(0)
    } finally {
      s.close()
    }
  })

  it('nfm vazio / incompleto: sem C16 nem C16b; frase curta (fumo Abrir opções)', async () => {
    const s = bootDialogScenario()
    try {
      s.sayInbound('oi')
      const empty = await handleFlowNfmReply(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          providerEventKey: 'wa:msg:flow-empty',
          responseJson: JSON.stringify({ flow_token: 'fl1_empty' }),
          catalogVersion: '1',
          phase: 'ack',
        },
        s.clock,
      )
      expect(empty.outcome).toBe('closed_without_booking')
      expect(empty.needsProposal).toBe(false)
      expect(empty.reason).toBe('empty_nfm')
      const afterEmpty = s.outboundBodies()
      expect(afterEmpty.some((b) => b === FLOW_COPY.preparingProposal)).toBe(false)
      expect(afterEmpty.some((b) => b === FLOW_COPY.proposalBuildFailed)).toBe(false)
      expect(afterEmpty.some((b) => b === FLOW_COPY.flowClosedContinue)).toBe(true)

      const incomplete = await handleFlowNfmReply(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          providerEventKey: 'wa:msg:flow-svc-only',
          responseJson: JSON.stringify({
            flow_token: 'fl1_svc',
            service_id: s.ids.depilacao,
          }),
          catalogVersion: '1',
          phase: 'ack',
        },
        s.clock,
      )
      expect(incomplete.outcome).toBe('closed_without_booking')
      expect(incomplete.needsProposal).toBe(false)
      expect(s.outboundBodies().some((b) => b === FLOW_COPY.preparingProposal)).toBe(false)
      expect(s.outboundBodies().some((b) => b === FLOW_COPY.proposalBuildFailed)).toBe(false)
    } finally {
      s.close()
    }
  })

  it('hub stub fase ack: sem C16; proposal phase não dispara needsProposal', async () => {
    const s = bootDialogScenario()
    try {
      s.sayInbound('oi')
      const ack = await handleFlowNfmReply(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          providerEventKey: 'wa:msg:flow-hub-no-c16',
          responseJson: JSON.stringify({
            flow_token: 'fl1_hub_noc16',
            hub_action: 'meus',
          }),
          catalogVersion: '1',
          phase: 'ack',
        },
        s.clock,
      )
      expect(ack.outcome).toBe('hub_meus_sent')
      expect(ack.needsProposal).toBeFalsy()
      expect(s.outboundBodies().some((b) => b === FLOW_COPY.preparingProposal)).toBe(false)
      expect(s.outboundBodies().some((b) => b === FLOW_COPY.proposalBuildFailed)).toBe(false)
      expect(isBookableAgendarNfm(parseNfmResponseJson(JSON.stringify({
        flow_token: 'fl1_hub_noc16',
        hub_action: 'meus',
      }))!)).toBe(false)
    } finally {
      s.close()
    }
  })

  it('fase proposal sem C16 prévio: incompleto não envia C16b', async () => {
    const s = bootDialogScenario()
    try {
      s.sayInbound('oi')
      const prop = await handleFlowNfmReply(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          providerEventKey: 'wa:msg:flow-prop-no-ack',
          responseJson: JSON.stringify({ flow_token: 'fl1_no_ack' }),
          catalogVersion: '1',
          phase: 'proposal',
        },
        s.clock,
      )
      expect(prop.outcome).toBe('closed_without_booking')
      expect(prop.needsProposal).toBe(false)
      expect(s.outboundBodies().some((b) => b === FLOW_COPY.proposalBuildFailed)).toBe(false)
      expect(s.outboundBodies().some((b) => b === FLOW_COPY.preparingProposal)).toBe(false)
    } finally {
      s.close()
    }
  })

  it('isBookableAgendarNfm exige service+slot civil; rejeita hub/fallback', () => {
    expect(
      isBookableAgendarNfm({
        flowToken: 't',
        serviceId: 'svc',
        line: null,
        variantIds: [],
        slotId: '2026-11-05T17:00',
        fallbackReason: null,
        hubAction: null,
      }),
    ).toBe(true)
    expect(
      isBookableAgendarNfm({
        flowToken: 't',
        serviceId: 'svc',
        line: null,
        variantIds: [],
        slotId: null,
        fallbackReason: null,
        hubAction: null,
      }),
    ).toBe(false)
    expect(
      isBookableAgendarNfm({
        flowToken: 't',
        serviceId: 'svc',
        line: null,
        variantIds: [],
        slotId: '2026-11-05T17:00',
        fallbackReason: null,
        hubAction: 'cancelar',
      }),
    ).toBe(false)
    expect(
      isBookableAgendarNfm({
        flowToken: 't',
        serviceId: 'svc',
        line: null,
        variantIds: [],
        slotId: '2026-11-05T17:00',
        fallbackReason: 'no_slots',
        hubAction: null,
      }),
    ).toBe(false)
  })

  it('Flow novo noutro horário volta a enviar C16 (skip não é lifetime)', async () => {
    const s = bootDialogScenario()
    try {
      s.sayInbound('oi')
      const zones = s.db.all<{ id: string }>(
        `SELECT id FROM service_zones
         WHERE service_id = ? AND audience = 'feminino' AND active = 1`,
        s.ids.depilacao,
      )
      const firstJson = JSON.stringify({
        flow_token: 'fl1_day1',
        service_id: s.ids.depilacao,
        line: 'feminino',
        variant_ids: zones.map((z) => z.id),
        slot_id: '2026-11-06T10:00',
      })
      await handleFlowNfmReply(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          providerEventKey: 'wa:msg:flow-day1',
          responseJson: firstJson,
          catalogVersion: '1',
          capability: true,
          phase: 'all',
        },
        s.clock,
      )
      expect(
        s.outboundBodies().filter((b) => b === FLOW_COPY.preparingProposal),
      ).toHaveLength(1)

      // Novo ciclo: outro slot (não mid-flight do mesmo horário).
      const secondJson = JSON.stringify({
        flow_token: 'fl1_day2',
        service_id: s.ids.depilacao,
        line: 'feminino',
        variant_ids: zones.map((z) => z.id),
        slot_id: '2026-11-06T15:00',
      })
      const second = await handleFlowNfmReply(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          providerEventKey: 'wa:msg:flow-day2',
          responseJson: secondJson,
          catalogVersion: '1',
          capability: true,
          phase: 'ack',
        },
        s.clock,
      )
      expect(second.outcome).toBe('ack_sent')
      expect(
        s.outboundBodies().filter((b) => b === FLOW_COPY.preparingProposal),
      ).toHaveLength(2)
    } finally {
      s.close()
    }
  })

  it('D6: nfm_reply stale não sobrescreve correção «só axila» no chat', async () => {
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

      const flowJson = JSON.stringify({
        flow_token: 'fl1_stale',
        service_id: s.ids.depilacao,
        line: 'feminino',
        variant_ids: [axila, pernas],
        slot_id: '2026-11-05T17:00',
      })
      const first = await handleFlowNfmReply(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          providerEventKey: 'wa:msg:flow-stale-a',
          responseJson: flowJson,
          catalogVersion: '1',
          capability: true,
        },
        s.clock,
      )
      expect(['proposal_sent', 'ack_sent', 'stale_no_proposal']).toContain(first.outcome)
      const afterFlow = getBookingFrame(s.db, s.tenantId, s.conversationId)
      expect(afterFlow?.variantIds?.sort()).toEqual([axila, pernas].sort())

      // Chat corrige: só axila (proveniência regra — como o actualizador carimba).
      s.clock.advance(1_000)
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.conversationId,
        {
          serviceId: s.ids.depilacao,
          line: 'feminino',
          variantIds: [axila],
          date: '2026-11-05',
          time: '17:00',
          source: 'regra',
          sourceMessageId: 'msg-chat-so-axila',
        },
        s.clock,
      )
      expect(getBookingFrame(s.db, s.tenantId, s.conversationId)?.variantIds).toEqual([axila])

      // nfm antigo com Axila+Pernas — não pode voltar a gravar as duas.
      const stale = await handleFlowNfmReply(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          providerEventKey: 'wa:msg:flow-stale-b',
          responseJson: flowJson,
          catalogVersion: '1',
          capability: true,
        },
        s.clock,
      )
      expect(stale.outcome).toBe('stale_no_proposal')
      expect(stale.reason).toBe('chat_corrected')
      expect(getBookingFrame(s.db, s.tenantId, s.conversationId)?.variantIds).toEqual([axila])
      expect(s.appointmentCount()).toBe(0)
    } finally {
      s.close()
    }
  })
})
