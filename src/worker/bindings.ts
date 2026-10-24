import type { ClinicDurableObject } from './clinic-do'

/** Bindings partilhados Worker ↔ Clinic DO (evita ciclo app ↔ clinic-do). */
export type WorkerBindings = {
  DB: D1Database
  CLINIC: DurableObjectNamespace<ClinicDurableObject>
  ATTACHMENTS: R2Bucket
  INBOUND_EVENTS: Queue
  ENVIRONMENT?: string
  CLERK_SECRET_KEY?: string
  CLERK_PUBLISHABLE_KEY?: string
  CLERK_JWT_KEY?: string
  CLERK_AUTHORIZED_PARTIES?: string
  AUTH_MODE?: string
}
