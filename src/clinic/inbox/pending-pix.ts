import type { ClinicDb } from '../store'

/**
 * Pix pendente do contato (Decidido, 28/10/2026): cobrança em `pix_charges`
 * com status `awaiting_payment` e ainda dentro do prazo (ou sem prazo).
 * Só leitura — bloquear o contato NÃO cancela nem altera o Pix.
 */
export function contactHasPendingPix(
  db: ClinicDb,
  tenantId: string,
  contactId: string,
  nowMs: number,
): boolean {
  const row = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM pix_charges
     WHERE tenant_id = ? AND contact_id = ?
       AND status = 'awaiting_payment'
       AND (expires_at IS NULL OR expires_at > ?)`,
    tenantId,
    contactId,
    nowMs,
  )
  return (row?.n ?? 0) > 0
}
