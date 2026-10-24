import { DurableObject } from 'cloudflare:workers'
import {
  acknowledgeOutboxResult,
  assertSyntheticTenantId,
  bindOrAssertTenant,
  fromDurableObjectSql,
  getBoundTenant,
  ingestContactMessage,
  listContacts,
  listPendingOutbox,
  publishPendingEffects,
  runClinicMigrations,
  TenantMismatchError,
  type ClinicCaller,
  type ClinicDb,
  type ConsumerResult,
  type EventEnvelope,
  type IngestContactMessageInput,
  workerCaller,
} from '../clinic'
import { systemClock, type Clock } from '../db/clock'
import type { WorkerBindings } from './app'

type ClinicEnv = WorkerBindings

/**
 * Clinic Durable Object — um por clínica (DEC-038 / ADR-0012 / issue #20).
 * SQLite nativo + migrações por instância + outbox durável.
 * WebSocket de produto e Clerk ficam em #23 / #21; eco WS do harness permanece.
 */
export class ClinicDurableObject extends DurableObject<ClinicEnv> {
  #db: ClinicDb
  #clock: Clock = systemClock
  #ready = false

  constructor(ctx: DurableObjectState, env: ClinicEnv) {
    super(ctx, env)
    // SqlStorageValue ⊆ SqlValue; adaptador tipado de forma estrutural.
    this.#db = fromDurableObjectSql(this.ctx.storage as Parameters<typeof fromDurableObjectSql>[0])
    this.ctx.blockConcurrencyWhile(async () => {
      runClinicMigrations(this.#db, this.#clock)
      this.#ready = true
    })
  }

  #ensureReady(): void {
    if (!this.#ready) {
      runClinicMigrations(this.#db, this.#clock)
      this.#ready = true
    }
  }

  /**
   * Instância criada via `idFromName(clinicId)` — o nome é a fonte do tenant.
   * RPC/job com tenant diferente é recusado mesmo antes de clinic_meta.
   */
  #assertInstanceTenant(caller: ClinicCaller): string {
    const name = this.ctx.id.name
    if (!name) {
      throw new TenantMismatchError('DO sem nome estável (idFromName obrigatório)')
    }
    assertSyntheticTenantId(name)
    if (caller.tenantId !== name) {
      throw new TenantMismatchError(
        `instância=${name} chamador=${caller.tenantId}`,
      )
    }
    return name
  }

  /** Harness F0/F1 — isolamento por instância. */
  async ping(tenantId: string): Promise<{ ok: true; tenantId: string; value: string }> {
    this.#ensureReady()
    assertSyntheticTenantId(tenantId)
    const caller = workerCaller(tenantId)
    this.#assertInstanceTenant(caller)
    bindOrAssertTenant(this.#db, caller, this.#clock)

    const now = this.#clock.nowMs()
    this.#db.run(
      `INSERT INTO f0_probe (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      'last_ping',
      tenantId,
      now,
    )
    const row = this.#db.get<{ value: string }>(
      'SELECT value FROM f0_probe WHERE key = ?',
      'last_ping',
    )
    return { ok: true, tenantId, value: row!.value }
  }

  async getStatus(caller: ClinicCaller): Promise<{
    tenantId: string
    schemaReady: true
    pendingOutbox: number
    contactCount: number
  }> {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const meta = bindOrAssertTenant(this.#db, caller, this.#clock)
    return {
      tenantId: meta.tenantId,
      schemaReady: true,
      pendingOutbox: listPendingOutbox(this.#db, meta.tenantId).length,
      contactCount: listContacts(this.#db, meta.tenantId).length,
    }
  }

  /**
   * Ingestão operacional com outbox na mesma transação SQLite.
   * Publicação para Queue ocorre depois (drain), nunca dentro da TX.
   */
  async ingestMessage(
    caller: ClinicCaller,
    input: IngestContactMessageInput,
    opts: { drain?: boolean } = {},
  ): Promise<{
    duplicate: boolean
    contactId: string
    inboundId: string
    outboxId: string | null
    drained: string[]
  }> {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const result = ingestContactMessage(this.#db, caller, input, this.#clock)

    let drained: string[] = []
    if (opts.drain !== false) {
      const pub = await this.#drain(caller)
      drained = pub.published
    }

    return {
      duplicate: result.duplicate,
      contactId: result.contact.id,
      inboundId: result.inbound.id,
      outboxId: result.outbox?.id ?? null,
      drained,
    }
  }

  /** Recuperação pós-crash / hibernação: republica pending sem duplicar entidades. */
  async drainOutbox(caller: ClinicCaller): Promise<{ published: string[]; failed: string[] }> {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    return this.#drain(caller)
  }

  async acknowledgeResult(
    caller: ClinicCaller,
    result: ConsumerResult,
  ): Promise<{ processingState: string }> {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    bindOrAssertTenant(this.#db, caller, this.#clock)
    if (result.tenantId !== caller.tenantId) {
      throw new TenantMismatchError(
        `result.tenantId=${result.tenantId} caller=${caller.tenantId}`,
      )
    }
    const row = acknowledgeOutboxResult(this.#db, result)
    return { processingState: row.processingState }
  }

  async listSyntheticContacts(caller: ClinicCaller): Promise<
    Array<{ id: string; waId: string; displayName: string | null }>
  > {
    this.#ensureReady()
    this.#assertInstanceTenant(caller)
    const meta = bindOrAssertTenant(this.#db, caller, this.#clock)
    return listContacts(this.#db, meta.tenantId).map((c) => ({
      id: c.id,
      waId: c.waId,
      displayName: c.displayName,
    }))
  }

  async #drain(caller: ClinicCaller): Promise<{ published: string[]; failed: string[] }> {
    const queue = this.env.INBOUND_EVENTS
    return publishPendingEffects(
      this.#db,
      caller,
      {
        async publish(envelope: EventEnvelope) {
          // Efeito externo FORA da transação SQLite.
          await queue.send({
            source: 'clinic_outbox',
            tenantId: envelope.tenantId,
            eventId: envelope.eventId,
            type: envelope.type,
            idempotencyKey: envelope.idempotencyKey,
            entity: envelope.entity,
            occurredAt: envelope.occurredAt,
            payload: envelope.payload,
          })
        },
      },
      this.#clock,
    )
  }

  async alarm(): Promise<void> {
    this.#ensureReady()
    const meta = getBoundTenant(this.#db)
    if (!meta) return
    await this.#drain(workerCaller(meta.tenantId))
  }

  async fetch(request: Request): Promise<Response> {
    this.#ensureReady()
    const upgrade = request.headers.get('Upgrade')
    if (upgrade?.toLowerCase() === 'websocket') {
      const pair = new WebSocketPair()
      const client = pair[0]
      const server = pair[1]
      this.ctx.acceptWebSocket(server)
      return new Response(null, { status: 101, webSocket: client })
    }

    const url = new URL(request.url)
    if (url.pathname.endsWith('/ping')) {
      const tenantId = request.headers.get('x-tenant-id') ?? 'unknown'
      try {
        return Response.json(await this.ping(tenantId))
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : 'ping_failed' },
          { status: 400 },
        )
      }
    }

    return Response.json({ error: 'not_found', phase: 'f1-clinic-do' }, { status: 404 })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const text = typeof message === 'string' ? message : new TextDecoder().decode(message)
    // Eco de harness apenas — fan-out de produto em #23.
    ws.send(JSON.stringify({ echo: text, phase: 'f1' }))
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    void wasClean
    try {
      ws.close(code, reason)
    } catch {
      // Já fechado.
    }
  }
}
