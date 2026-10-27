import { describe, expect, it } from 'vitest'
import {
  createMemoryWsTicketStorage,
  hashWsTicket,
  isWellFormedWsTicket,
  issueWsTicket,
  redeemWsTicket,
  WS_TICKET_TTL_MS,
} from './ticket'

const grant = {
  tenantId: 'clinic-demo-a',
  clerkUserId: 'user_synth_owner_a',
  sessionId: 'sess_1',
  role: 'owner' as const,
}

describe('bilhete WS de uso único', () => {
  it('emite bilhete opaco e guarda só o hash', async () => {
    const storage = createMemoryWsTicketStorage()
    const { ticket, expiresAt } = await issueWsTicket(storage, grant, 1_000)
    expect(isWellFormedWsTicket(ticket)).toBe(true)
    expect(expiresAt).toBe(1_000 + WS_TICKET_TTL_MS)
    const keys = [...(await storage.list({ prefix: '' })).keys()]
    expect(keys).toHaveLength(1)
    expect(keys[0]).not.toContain(ticket)
    expect(keys[0]).toContain(await hashWsTicket(ticket))
  })

  it('resgata uma vez; segunda tentativa é inválida', async () => {
    const storage = createMemoryWsTicketStorage()
    const { ticket } = await issueWsTicket(storage, grant, 1_000)
    const first = await redeemWsTicket(storage, ticket, 'clinic-demo-a', 2_000)
    expect(first).toEqual({ ok: true, grant: { ...grant, expiresAt: 1_000 + WS_TICKET_TTL_MS } })
    const second = await redeemWsTicket(storage, ticket, 'clinic-demo-a', 2_000)
    expect(second).toEqual({ ok: false, reason: 'ticket_invalid' })
  })

  it('expirado → ticket_expired (e consumido)', async () => {
    const storage = createMemoryWsTicketStorage()
    const { ticket } = await issueWsTicket(storage, grant, 1_000)
    const r = await redeemWsTicket(storage, ticket, 'clinic-demo-a', 1_000 + WS_TICKET_TTL_MS)
    expect(r).toEqual({ ok: false, reason: 'ticket_expired' })
    expect(storage.size()).toBe(0)
  })

  it('outro tenant → recusado (sem fuga cross-tenant)', async () => {
    const storage = createMemoryWsTicketStorage()
    const { ticket } = await issueWsTicket(storage, grant, 1_000)
    const r = await redeemWsTicket(storage, ticket, 'clinic-demo-b', 2_000)
    expect(r).toEqual({ ok: false, reason: 'ticket_tenant_mismatch' })
  })

  it('malformado / desconhecido → ticket_invalid', async () => {
    const storage = createMemoryWsTicketStorage()
    expect(await redeemWsTicket(storage, 'abc', 'clinic-demo-a', 0)).toEqual({
      ok: false,
      reason: 'ticket_invalid',
    })
    expect(
      await redeemWsTicket(storage, `wst_${'A'.repeat(43)}`, 'clinic-demo-a', 0),
    ).toEqual({ ok: false, reason: 'ticket_invalid' })
  })

  it('limpa bilhetes expirados ao emitir', async () => {
    const storage = createMemoryWsTicketStorage()
    await issueWsTicket(storage, grant, 0)
    await issueWsTicket(storage, grant, WS_TICKET_TTL_MS + 1)
    expect(storage.size()).toBe(1)
  })
})
