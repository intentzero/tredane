import { DurableObject } from 'cloudflare:workers'

/**
 * Harness F0 do DO por clínica (DEC-038 / ADR-0012).
 * Prova SQLite nativo e WebSocket com hibernação no runtime Cloudflare.
 * Domínio operacional (contatos, agenda, outbox) chega na issue #20 — não tratar
 * este stub como funcionalidade de produto.
 */
export class ClinicDurableObject extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never)
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS f0_probe (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `)
    })
  }

  async ping(tenantId: string): Promise<{ ok: true; tenantId: string; value: string }> {
    const now = Date.now()
    this.ctx.storage.sql.exec(
      `INSERT INTO f0_probe (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      'last_ping',
      tenantId,
      now,
    )
    const row = this.ctx.storage.sql
      .exec<{ value: string }>('SELECT value FROM f0_probe WHERE key = ?', 'last_ping')
      .one()
    return { ok: true, tenantId, value: row.value }
  }

  async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get('Upgrade')
    if (upgrade?.toLowerCase() === 'websocket') {
      const pair = new WebSocketPair()
      const client = pair[0]
      const server = pair[1]
      this.ctx.acceptWebSocket(server)
      return new Response(null, { status: 101, webSocket: client })
    }

    if (new URL(request.url).pathname.endsWith('/ping')) {
      const tenantId = request.headers.get('x-tenant-id') ?? 'unknown'
      return Response.json(await this.ping(tenantId))
    }

    return Response.json({ error: 'not_found', phase: 'f0-clinic-do' }, { status: 404 })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const text = typeof message === 'string' ? message : new TextDecoder().decode(message)
    ws.send(JSON.stringify({ echo: text, phase: 'f0' }))
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    void wasClean
    try {
      ws.close(code, reason)
    } catch {
      // Já fechado pelo cliente.
    }
  }
}
