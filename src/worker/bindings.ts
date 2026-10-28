import type { ClinicDurableObject } from './clinic-do'
import type { TenantPurgeWorkflowParams } from '../retention/workflow-params'

/** Bindings partilhados Worker ↔ Clinic DO (evita ciclo app ↔ clinic-do). */
export type WorkerBindings = {
  DB: D1Database
  CLINIC: DurableObjectNamespace<ClinicDurableObject>
  ATTACHMENTS: R2Bucket
  INBOUND_EVENTS: Queue
  /**
   * Workflow de expurgo de tenant (#43 polish).
   * Opcional em testes unitários sem binding; declarado em wrangler.jsonc.
   */
  TENANT_PURGE?: Workflow<TenantPurgeWorkflowParams>
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
  /** A2: chave AES-GCM de tokens Meta / App ID Woovi em repouso (obrigatória em staging/production). */
  TOKEN_ENCRYPTION_KEY?: string
  /** Token do challenge GET webhook (#32). Synthetic default se ausente. */
  META_VERIFY_TOKEN?: string
  /** STAGING-ONLY: `true` habilita POST .../whatsapp/dev/sync-existing-binding (exige ENVIRONMENT=staging). */
  WHATSAPP_DEV_SYNC_ENABLED?: string
  /** STAGING-ONLY: `true` habilita POST /api/ops/demo-clinic/seed (exige ENVIRONMENT=staging + DEMO_SEED_TOKEN). */
  DEMO_SEED_ENABLED?: string
  /** wrangler secret (staging) — bearer do seed da clínica demo; nunca versionar. */
  DEMO_SEED_TOKEN?: string
  /** Segredo HMAC para tokens efémeros de download de anexos (#34). */
  ATTACHMENT_TOKEN_SECRET?: string
  /**
   * Pix / Woovi (#37): `synthetic` (default) | `sandbox` | `live`.
   * Live/sandbox reais exigem GATE-08 (DPA) + App ID da clínica; CI usa synthetic.
   */
  PIX_MODE?: string
  /** Segredo para cifrar App ID Woovi em repouso (opcional em synthetic). */
  PIX_TOKEN_SECRET?: string
  /**
   * IA assistiva (#41): `synthetic` (default) | `gateway`.
   * Gateway real exige GATE-06 + chaves; CI usa synthetic / mock.
   */
  AI_MODE?: string
  /** «off» desliga o agendamento pela IA após confirmação explícita (28/10/2026). */
  AI_AUTOBOOK?: string
  AI_AUTOBOOK_TENANTS?: string
  /** S7 (#178): «on» liga os limites de abuso (padrão desligado). Valores: ABUSE_LIMIT_* (Proposto). */
  ABUSE_LIMITS?: string
  CF_ACCOUNT_ID?: string
  AI_GATEWAY_ID?: string
  /** Token do AI Gateway — wrangler secret; nunca versionar. */
  AI_GATEWAY_TOKEN?: string
  /** BYOK Anthropic opcional. */
  ANTHROPIC_API_KEY?: string
  /**
   * Web Push / PWA (#42): `synthetic` (default) | `live`.
   * Live exige VAPID_*; CI e local usam synthetic sem HTTP a FCM/APNs.
   */
  PUSH_MODE?: string
  VAPID_PUBLIC_KEY?: string
  /** wrangler secret — nunca versionar. */
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT?: string
}
