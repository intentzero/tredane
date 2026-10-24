import { ADMIN_SCHEMA_VERSION } from './constants'
import { SchemaNotReadyError } from './errors'
import type { AdminDb } from './store'

/**
 * Impede uso de schema parcial: repositórios administrativos exigem
 * `admin_schema_state.version === ADMIN_SCHEMA_VERSION` antes de ler/escrever.
 */
export function assertAdminSchemaReady(db: AdminDb): void {
  let row: { version: number } | undefined
  try {
    row = db.get<{ version: number }>('SELECT version FROM admin_schema_state WHERE id = 1')
  } catch (err) {
    throw new SchemaNotReadyError(
      `tabela admin_schema_state indisponível (${err instanceof Error ? err.message : 'erro'})`,
    )
  }
  if (!row) {
    throw new SchemaNotReadyError('versão administrativa ausente')
  }
  if (row.version !== ADMIN_SCHEMA_VERSION) {
    throw new SchemaNotReadyError(
      `esperada ${ADMIN_SCHEMA_VERSION}, encontrada ${row.version}`,
    )
  }
}
