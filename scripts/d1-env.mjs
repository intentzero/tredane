/**
 * Nomes D1 e helpers partilhados pelos scripts de migrate/smoke remotos.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const D1_DATABASE_BY_ENV = {
  staging: 'tredane-staging',
  production: 'tredane-production',
}

export const D1_ENVS = Object.keys(D1_DATABASE_BY_ENV)

/** Lê ADMIN_SCHEMA_VERSION de src/db/admin/constants.ts (sem carregar TS). */
export function readAdminSchemaVersion(cwd = process.cwd()) {
  const text = readFileSync(resolve(cwd, 'src/db/admin/constants.ts'), 'utf8')
  const m = text.match(/export const ADMIN_SCHEMA_VERSION\s*=\s*(\d+)/)
  if (!m) {
    throw new Error('ADMIN_SCHEMA_VERSION não encontrado em src/db/admin/constants.ts')
  }
  return Number(m[1])
}

/**
 * Mensagem clara quando o token Cloudflare não tem D1:Edit
 * (ou autenticação falha no caminho de migrate/smoke).
 */
export function d1PermissionHint(stderr = '', stdout = '') {
  const blob = `${stderr}\n${stdout}`.toLowerCase()
  const looksAuth =
    blob.includes('authentication error') ||
    blob.includes('unauthorized') ||
    blob.includes('403') ||
    blob.includes('1010') ||
    blob.includes('not authorized') ||
    blob.includes('permission') ||
    blob.includes('insufficient') ||
    blob.includes('code: 9109') ||
    blob.includes('code: 10000')
  if (!looksAuth) return null
  return [
    'Falha de autenticação/permissão no D1 remoto.',
    'O job de migrate/smoke precisa de Account · D1: Edit no token Cloudflare.',
    'Opções: alargar CLOUDFLARE_API_TOKEN do environment GitHub, ou criar',
    'CLOUDFLARE_API_TOKEN_D1 com D1:Edit (e Workers Scripts se partilhar o deploy).',
    'Ver docs/DEPLOY.md.',
  ].join(' ')
}

/** Extrai `version` do JSON de `wrangler d1 execute --json`. */
export function parseAdminSchemaVersionFromExecuteJson(raw) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw
  const rows = []
  const visit = (node) => {
    if (node == null) return
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    if (typeof node !== 'object') return
    if (Array.isArray(node.results)) {
      for (const row of node.results) {
        if (row && typeof row === 'object' && 'version' in row) rows.push(row.version)
      }
    }
    for (const v of Object.values(node)) visit(v)
  }
  visit(data)
  if (rows.length === 0) {
    const preview = typeof raw === 'string' ? raw.slice(0, 400) : JSON.stringify(data).slice(0, 400)
    throw new Error(`resposta wrangler sem version: ${preview}`)
  }
  return Number(rows[0])
}
