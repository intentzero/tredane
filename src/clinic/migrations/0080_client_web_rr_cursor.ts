/**
 * Cursor de round-robin «Sem preferência» por serviço (DEC-218).
 * Guarda a última profissional atribuída pela página quando a cliente não escolheu.
 */
export const MIGRATION_ID = 80
export const MIGRATION_NAME = '0080_client_web_rr_cursor'

export const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS client_web_rr_cursor (
     tenant_id TEXT NOT NULL,
     service_id TEXT NOT NULL,
     last_professional_id TEXT NOT NULL,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (tenant_id, service_id)
   )`,
] as const
