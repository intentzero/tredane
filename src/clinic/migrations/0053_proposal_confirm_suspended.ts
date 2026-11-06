/**
 * Migração 53 — Confirmar suspenso enquanto o eco de uma substituição
 * resolvida está aberto (DEC-137 / DEC-061, leitura 06/11/2026).
 * A linha fica. Corrigir limpa a marca se a proposta ainda estiver no prazo.
 * Sim segue para proposta nova, que substitui esta de vez.
 */
export const MIGRATION_ID = 53
export const MIGRATION_NAME = '0053_proposal_confirm_suspended'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE appointment_proposals ADD COLUMN confirm_suspended INTEGER NOT NULL DEFAULT 0
    CHECK (confirm_suspended IN (0, 1))`,
]
