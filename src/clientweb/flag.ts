import type { WorkerBindings } from '../worker/bindings'

/** Interruptor global (DEC-199): `CLIENT_WEB_ENABLED=true`. O da owner, por clínica, está em `settings.ts`. */
export function isClientWebEnabled(env: Pick<WorkerBindings, 'CLIENT_WEB_ENABLED'> | undefined): boolean {
  return env?.CLIENT_WEB_ENABLED === 'true'
}
