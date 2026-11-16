#!/usr/bin/env node
/**
 * Empacota o Worker como no deploy (wrangler --dry-run) e avalia o bundle em Node.
 * Falha se a inicialização dos módulos lançar (p.ex. TDZ por import circular).
 *
 * Requer `npm run build` com CLOUDFLARE_ENV=staging (gera dist/ + wrangler de staging).
 * Sem credenciais Cloudflare — só --dry-run local.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { register } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hook = pathToFileURL(join(root, 'scripts/worker-bundle-import-hook.mjs')).href
register(hook)

function builtStagingConfigOk() {
  const redirect = join(root, '.wrangler/deploy/config.json')
  if (!existsSync(redirect)) return false
  const cfgPath = join(dirname(redirect), JSON.parse(readFile(redirect)).configPath)
  const resolved = resolve(dirname(redirect), cfgPath)
  if (!existsSync(resolved)) return false
  const name = JSON.parse(readFile(resolved)).name ?? ''
  return name === 'tredane-dev-staging'
}

function readFile(p) {
  return readFileSync(p, 'utf8')
}

function ensureStagingBuild() {
  if (builtStagingConfigOk()) return
  console.log('check-worker-bundle: building with CLOUDFLARE_ENV=staging …')
  const r = spawnSync('npm', ['run', 'build'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CLOUDFLARE_ENV: 'staging' },
  })
  if (r.status !== 0) process.exit(r.status ?? 1)
  if (!builtStagingConfigOk()) {
    console.error('check-worker-bundle: build não gerou config staging (tredane-dev-staging).')
    process.exit(1)
  }
}

function bundleWorker() {
  const outDir = mkdtempSync(join(tmpdir(), 'tredane-worker-bundle-'))
  const r = spawnSync(
    'npx',
    ['wrangler', 'deploy', '--dry-run', '--outdir', outDir, '--env', 'staging'],
    { cwd: root, stdio: 'pipe', encoding: 'utf8' },
  )
  if (r.status !== 0) {
    console.error(r.stdout)
    console.error(r.stderr)
    process.exit(r.status ?? 1)
  }
  const assets = join(outDir, 'assets')
  const entry = readdirSync(assets).find((f) => f.startsWith('worker-entry-') && f.endsWith('.js'))
  if (!entry) {
    console.error('check-worker-bundle: worker-entry*.js não encontrado em', assets)
    process.exit(1)
  }
  return join(assets, entry)
}

async function main() {
  ensureStagingBuild()
  const entryPath = bundleWorker()
  const entryUrl = pathToFileURL(entryPath).href
  try {
    await import(entryUrl)
    console.log('check-worker-bundle: OK — bundle avaliado sem erro de init.')
  } catch (err) {
    console.error('check-worker-bundle: falha ao avaliar o bundle Worker:', err)
    process.exit(1)
  }
}

main()