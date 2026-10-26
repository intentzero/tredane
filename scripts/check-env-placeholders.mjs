#!/usr/bin/env node
/**
 * Impede deploy com IDs fictícios de staging/prod (critério #15).
 * Placeholders locais em development são permitidos; staging/prod exigem
 * UUIDs reais provisionados na conta Cloudflare.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Vars obrigatórias em env.<staging|production>.vars (revisão de segurança A4). */
export const REQUIRED_VARS = ['CLERK_PUBLISHABLE_KEY', 'CLERK_AUTHORIZED_PARTIES']
/** Secrets obrigatórios sempre em staging/production (A1/A4). */
export const REQUIRED_SECRETS = ['CLERK_SECRET_KEY', 'ATTACHMENT_TOKEN_SECRET', 'TOKEN_ENCRYPTION_KEY']
/** Secrets exigidos quando o modo correspondente é `live` (C3/C4). */
export const MODE_SECRETS = {
  META_MODE: ['META_APP_SECRET', 'META_VERIFY_TOKEN', 'META_TOKEN_SECRET'],
  PIX_MODE: ['PIX_TOKEN_SECRET'],
}

const PLACEHOLDER_RE =
  /00000000-0000-4000-a000-0000000000(?:aa|ff)|UNPROVISIONED_[A-Z0-9_]+/g

const configPath = resolve(process.cwd(), 'wrangler.jsonc')
const raw = readFileSync(configPath, 'utf8')
const text = raw.replace(/^\s*\/\/.*$/gm, '')

const env = process.env.CLOUDFLARE_ENV ?? process.env.WRANGLER_ENV ?? ''
const target = process.argv[2] ?? env

if (!target || target === 'development' || target === 'dev' || target === 'local') {
  console.log('check-env-placeholders: alvo local/dev — OK (placeholders locais permitidos).')
  process.exit(0)
}

if (target !== 'staging' && target !== 'production') {
  console.error(`check-env-placeholders: ambiente desconhecido "${target}". Use staging|production|dev.`)
  process.exit(1)
}

// Isolar o bloco env.<target> para não misturar placeholders de outro ambiente.
const envKey = `"${target}"`
const envIdx = text.indexOf(envKey)
if (envIdx < 0) {
  console.error(`check-env-placeholders: bloco env.${target} não encontrado em wrangler.jsonc`)
  process.exit(1)
}
const afterKey = text.slice(envIdx)
const braceStart = afterKey.indexOf('{')
if (braceStart < 0) {
  console.error(`check-env-placeholders: bloco env.${target} malformado`)
  process.exit(1)
}
let depth = 0
let end = -1
for (let i = braceStart; i < afterKey.length; i += 1) {
  const ch = afterKey[i]
  if (ch === '{') depth += 1
  else if (ch === '}') {
    depth -= 1
    if (depth === 0) {
      end = i
      break
    }
  }
}
const block = end >= 0 ? afterKey.slice(braceStart, end + 1) : afterKey
const unique = [...new Set([...block.matchAll(PLACEHOLDER_RE)].map((m) => m[0]))]

const errors = []
if (unique.length > 0) {
  errors.push(
    'ainda há placeholders fictícios:\n' + unique.map((id) => `  - ${id}`).join('\n') +
      '\n  Provisionar recursos reais e atualizar wrangler.jsonc antes do deploy.',
  )
}

// Vars: extrair env.<target>.vars do bloco isolado.
let vars = {}
try {
  const parsed = JSON.parse(block.replace(/,(\s*[}\]])/g, '$1'))
  vars = parsed.vars ?? {}
} catch (err) {
  errors.push(`não foi possível interpretar env.${target}: ${String(err)}`)
}
const missingVars = REQUIRED_VARS.filter((k) => typeof vars[k] !== 'string' || !vars[k].trim())
if (missingVars.length > 0) {
  errors.push(`vars obrigatórias ausentes em env.${target}.vars: ${missingVars.join(', ')}`)
}
if (vars.AUTH_MODE && vars.AUTH_MODE !== 'clerk') {
  errors.push(`AUTH_MODE deve ser "clerk" em ${target} (atual: ${vars.AUTH_MODE})`)
}
if (typeof vars.CLERK_AUTHORIZED_PARTIES === 'string' && /localhost|127\.0\.0\.1/.test(vars.CLERK_AUTHORIZED_PARTIES)) {
  errors.push('CLERK_AUTHORIZED_PARTIES não pode conter localhost em staging/production')
}

// Secrets: nomes apenas (nunca valores). Fonte: CHECK_ENV_SECRET_NAMES (CI/testes) ou `wrangler secret list`.
const requiredSecrets = [...REQUIRED_SECRETS]
for (const [modeVar, names] of Object.entries(MODE_SECRETS)) {
  if (vars[modeVar] === 'live') requiredSecrets.push(...names)
}
let secretNames = null
if (process.env.CHECK_ENV_SECRET_NAMES !== undefined) {
  secretNames = process.env.CHECK_ENV_SECRET_NAMES.split(',').map((s) => s.trim()).filter(Boolean)
} else {
  const bin = resolve(process.cwd(), 'node_modules/.bin/wrangler')
  const r = spawnSync(bin, ['secret', 'list', '--env', target, '--format', 'json'], { encoding: 'utf8' })
  if (r.status === 0) {
    try {
      secretNames = JSON.parse(r.stdout).map((x) => x.name)
    } catch {
      secretNames = null
    }
  }
  if (!secretNames) {
    errors.push(
      `não foi possível listar secrets do Worker em ${target} (wrangler secret list); ` +
        'defina CHECK_ENV_SECRET_NAMES ou autentique o wrangler',
    )
  }
}
if (secretNames) {
  const missingSecrets = requiredSecrets.filter((n) => !secretNames.includes(n))
  if (missingSecrets.length > 0) {
    errors.push(`secrets obrigatórios ausentes em ${target}: ${missingSecrets.join(', ')}`)
  }
}

if (errors.length > 0) {
  console.error(
    `check-env-placeholders: recusado deploy para "${target}":\n` + errors.map((e) => `- ${e}`).join('\n'),
  )
  process.exit(1)
}

console.log(`check-env-placeholders: "${target}" sem placeholders, vars e secrets obrigatórios presentes — OK.`)
