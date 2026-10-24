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
  /** Base URL pública para links de convite (#25). */
  APP_BASE_URL?: string
  /** `simulated` (default em development) — provedor real Em aberto. */
  EMAIL_TRANSPORT?: string
}
