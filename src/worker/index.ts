import { app } from './app'
import { handleInboundQueue } from '../whatsapp/queue-consumer'
import type { WorkerBindings } from './bindings'
import type { InboundQueueMessage } from '../whatsapp/queue-types'

export { ClinicDurableObject } from './clinic-do'

/**
 * Worker: HTTP (Hono) + consumer da fila INBOUND_EVENTS (#32).
 */
const worker = {
  fetch: app.fetch.bind(app),
  async queue(
    batch: MessageBatch<InboundQueueMessage>,
    env: WorkerBindings,
    ctx: ExecutionContext,
  ): Promise<void> {
    await handleInboundQueue(batch, env, ctx)
  },
}

export default worker
