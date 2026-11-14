#!/usr/bin/env node
/**
 * Deploy gate helper: should we skip typecheck/lint/npm test/runtime?
 *
 * Prints `skip=true` when this SHA already has a completed CI `verify` job
 * whose «Unit and SQL tests» step concluded **success** (not skipped/lite).
 * Otherwise `skip=false` (run the suite again).
 *
 * Usage (Actions):
 *   GH_TOKEN=… GITHUB_REPOSITORY=owner/repo SHA=… node scripts/ci-deploy-tests-already-green.mjs
 *
 * Writes to $GITHUB_OUTPUT when set; always logs the decision.
 */
import { appendFileSync } from 'node:fs'

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
const repo = process.env.GITHUB_REPOSITORY
const sha = process.env.SHA

if (!token || !repo || !sha) {
  console.error('Need GH_TOKEN, GITHUB_REPOSITORY, and SHA')
  process.exit(2)
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
}

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GitHub API ${res.status} ${path}: ${body.slice(0, 400)}`)
  }
  return res.json()
}

function emit(skip, reason) {
  const line = `skip=${skip ? 'true' : 'false'}`
  console.log(`${line} — ${reason}`)
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`)
  }
}

const runs = await gh(
  `/repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${encodeURIComponent(sha)}&per_page=20`,
)

const candidates = (runs.workflow_runs || []).filter(
  (r) => r.status === 'completed' && r.conclusion === 'success',
)

if (!candidates.length) {
  emit(false, `no successful CI workflow run for ${sha.slice(0, 7)}`)
  process.exit(0)
}

for (const run of candidates) {
  const jobs = await gh(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=50`)
  const verify = (jobs.jobs || []).find((j) => j.name === 'verify' && j.conclusion === 'success')
  if (!verify) continue
  const unit = (verify.steps || []).find((s) => s.name === 'Unit and SQL tests')
  if (unit?.conclusion === 'success') {
    emit(true, `CI run ${run.id}: verify «Unit and SQL tests» success`)
    process.exit(0)
  }
  if (unit?.conclusion === 'skipped') {
    console.log(`CI run ${run.id}: Unit and SQL tests skipped (lite verify) — keep looking`)
  }
}

emit(false, 'no CI verify with Unit and SQL tests success for this SHA')
