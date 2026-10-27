/**
 * Migração 21 — capacidade simultânea por sala (D-20261027-180200-CUR; detalhes
 * aprovados por Paulo no card t1892s7600, 27/10/2026). Alarga a DEC-008.
 * - resources.capacity: quantas pessoas a sala atende ao mesmo tempo
 *   (1–50, padrão 1). Profissional e equipamento ficam sempre com 1.
 * - resources.shared_space_notice: frase fixa da clínica, usada na confirmação
 *   pelo WhatsApp (DEC-053). Nunca diz quantas vagas restam.
 * Recursos existentes ficam com capacidade 1 → comportamento idêntico ao atual.
 */
export const MIGRATION_ID = 21
export const MIGRATION_NAME = '0021_room_capacity'

export const STATEMENTS: readonly string[] = [
  `ALTER TABLE resources ADD COLUMN capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity BETWEEN 1 AND 50)`,
  `ALTER TABLE resources ADD COLUMN shared_space_notice TEXT`,
]
