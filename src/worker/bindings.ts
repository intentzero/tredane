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
  /** WhatsApp Embedded Signup (#31): `synthetic` (default) | `live`. */
  META_MODE?: string
  META_APP_ID?: string
  META_APP_SECRET?: string
  META_CONFIG_ID?: string
  META_GRAPH_API_VERSION?: string
  /** Segredo para selar tokens Meta em D1 (opcional; fallback META_APP_SECRET). */
  META_TOKEN_SECRET?: string
  /** Token do challenge GET webhook (#32). Synthetic default se ausente. */
  META_VERIFY_TOKEN?: string
}
