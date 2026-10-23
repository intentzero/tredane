import { drizzle } from 'drizzle-orm/d1'
import * as schema from './schema'

/** Nunca usar esta função para inferir autorização de tenant. */
export function createDb(binding: D1Database) {
  return drizzle(binding, { schema })
}
