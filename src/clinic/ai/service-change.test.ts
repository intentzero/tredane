/**
 * #436 (CF-23): a cliente muda de serviço com uma proposta aberta. A antiga deixa de valer
 * (o clique é recusado, DEC-061), e a conversa segue com o serviço novo. Dados fictícios.
 */
import { describe, expect, it } from 'vitest'
import { executeProposalConfirmOp } from '../proposals/execute-confirm'
import { handleProposalButtonClick } from '../proposals/buttons'
import { proposalButtonId } from '../proposals/render'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'
import { bootDialogScenario, type DialogScenario } from './evals/dialogs/scenario'

async function say(s: DialogScenario, text: string): Promise<string[]> {
  const before = s.outboundBodies().length
  const id = s.sayInbound(text)
  enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.conversationId, messageId: id }, s.clock)
  s.clock.advance(7_000)
  await runDueAutoDrafts(s.db, s.caller, s.clock, { mode: 'synthetic', adapter: s.adapter })
  return s.outboundBodies().slice(before)
}

const states = (s: DialogScenario) =>
  s.db.all<{ state: string; service: string; starts_at: number }>(
    `SELECT p.state AS state, v.name AS service, p.starts_at AS starts_at
     FROM appointment_proposals p JOIN services v ON v.tenant_id = p.tenant_id AND v.id = p.service_id
     WHERE p.conversation_id = ? ORDER BY p.created_at, p.version`,
    s.conversationId,
  )

const OPEN = ['preparada', 'envio_pendente', 'envio_incerto', 'enviada']

describe('CF-23: mudança de serviço depois da proposta', () => {
  it('o clique no Confirmar da proposta antiga é recusado e nada é marcado', async () => {
    const s = bootDialogScenario()
    try {
      await say(s, 'Quero limpeza de pele amanhã às 15h')
      const old = s.db.get<{ id: string; version: number }>(
        `SELECT id, version FROM appointment_proposals WHERE conversation_id = ?`,
        s.conversationId,
      )!
      s.db.run(`UPDATE appointment_proposals SET send_provider_message_id = ? WHERE id = ?`, 'wamid.old', old.id)

      await say(s, 'na verdade prefiro massagem')

      const rows = states(s)
      expect(rows.filter((r) => r.state === 'substituida')).toHaveLength(1)
      expect(rows.filter((r) => OPEN.includes(r.state))).toHaveLength(1)
      expect(rows.find((r) => OPEN.includes(r.state))!.service).toBe('Massagem')

      const click = handleProposalButtonClick(
        s.db,
        {
          tenantId: s.tenantId,
          contactId: s.contactId,
          conversationId: s.conversationId,
          buttonId: proposalButtonId(old.id, old.version, 'confirm'),
          contextMessageId: 'wamid.old',
          providerEventKey: 'evt_old_click',
        },
        s.clock,
      )
      expect(click.handled).toBe(true)
      if ('handoff' in click) {
        const res = await executeProposalConfirmOp(
          s.db,
          s.caller,
          { handoff: click.handoff, capability: true, providerEventKey: 'evt_old_click', contextMessageId: 'wamid.old' },
          s.clock,
        )
        expect(res.status).not.toBe('booked')
      }
      expect(s.appointmentCount()).toBe(0)
    } finally {
      s.close()
    }
  })

  it('com dia e hora novos na mesma frase, a proposta nova usa esses e a antiga cai', async () => {
    const s = bootDialogScenario()
    try {
      await say(s, 'Quero limpeza de pele amanhã às 15h')
      const out = await say(s, 'prefiro massagem amanhã às 16h')
      const rows = states(s)
      expect(rows.filter((r) => r.state === 'substituida')).toHaveLength(1)
      const open = rows.filter((r) => OPEN.includes(r.state))
      expect(open).toHaveLength(1)
      expect(open[0]!.service).toBe('Massagem')
      expect(new Date(open[0]!.starts_at).toISOString()).toBe('2026-11-06T19:00:00.000Z') // sex 16:00 SP
      expect(out.join('\n')).toMatch(/Serviço:\s*Massagem/i)
    } finally {
      s.close()
    }
  })

  it('serviço com linha e zonas: a antiga cai e a conversa pergunta a linha, sem proposta nova', async () => {
    const s = bootDialogScenario()
    try {
      await say(s, 'Quero limpeza de pele amanhã às 15h')
      const out = await say(s, 'na verdade prefiro depilação')
      const rows = states(s)
      expect(rows.filter((r) => OPEN.includes(r.state))).toHaveLength(0)
      expect(rows.filter((r) => r.state === 'substituida')).toHaveLength(1)
      expect(out.join('\n')).toMatch(/feminina ou masculina/i)
    } finally {
      s.close()
    }
  })

  // Três turnos com autodraft — o default 5s do Vitest é curto para o cenário.
  it(
    'o mesmo serviço, um agradecimento ou uma pergunta não retiram a proposta',
    { timeout: 30_000 },
    async () => {
      const s = bootDialogScenario()
      try {
        await say(s, 'Quero limpeza de pele amanhã às 15h')
        await say(s, 'obrigada!')
        await say(s, 'é limpeza de pele mesmo')
        const rows = states(s)
        expect(rows).toHaveLength(1)
        expect(OPEN).toContain(rows[0]!.state)
      } finally {
        s.close()
      }
    },
  )

  it('sem vaga no horário da proposta antiga, oferece alternativas do serviço novo', async () => {
    const s = bootDialogScenario()
    try {
      await say(s, 'Quero limpeza de pele amanhã às 15h')
      // A massagem é só da Bia: ocupada sexta 15:00–16:00 (SP) = 18:00–19:00 UTC.
      const { createBlockOp } = await import('../config')
      createBlockOp(
        s.db,
        s.caller,
        { resourceId: s.ids.bia, startsAt: Date.UTC(2026, 10, 6, 18, 0), endsAt: Date.UTC(2026, 10, 6, 19, 0), reason: 'outro' },
        s.clock,
      )
      const out = await say(s, 'na verdade prefiro massagem')
      const rows = states(s)
      expect(rows.filter((r) => r.state === 'substituida')).toHaveLength(1)
      const open = rows.filter((r) => OPEN.includes(r.state))
      // Só a Bia faz massagem e está bloqueada: nenhuma proposta nova, avisa e oferece horas.
      expect(open).toHaveLength(0)
      expect(out.join('\n')).toMatch(/das 15:00 já não tenho vaga\. Tenho \d{2}:\d{2}/)
    } finally {
      s.close()
    }
  })
})
