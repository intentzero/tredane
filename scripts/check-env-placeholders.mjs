#!/usr/bin/env node
/**
 * Impede deploy com IDs fictícios de staging/prod (critério #15).
 * Placeholders locais em development são permitidos; staging/prod exigem
 * UUIDs reais provisionados na conta Cloudflare.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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

if (unique.length > 0) {
  console.error(
    `check-env-placeholders: recusado deploy para "${target}" — ainda há placeholders fictícios:\n` +
      unique.map((id) => `  - ${id}`).join('\n') +
      '\nProvisionar recursos reais e atualizar wrangler.jsonc antes do deploy.',
  )
  process.exit(1)
}

console.log(`check-env-placeholders: "${target}" sem placeholders fictícios — OK.`)
