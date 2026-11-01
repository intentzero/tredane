/**
 * Runner L1: aplica turnos inbound via enqueueAutoDraft + runDueAutoDrafts (#406).
 */
import type { AiProviderAdapter } from '../../../../ai'
import { enqueueAutoDraft, runDueAutoDrafts } from '../../index'
import { checkInvariants, type InvResult } from './invariants'
import { bootDialogScenario, DIALOG_TZ, type DialogScenario } from './scenario'

export type DialogTurn =
  | { role: 'client'; text: string }
  /** Várias bolhas seguidas antes do debounce: um único job com a última (CF-13). */
  | { role: 'burst'; texts: string[] }
  /** A clínica já tinha dito isto (conta como turno anterior, sem resposta do agente). */
  | { role: 'clinic'; text: string }
  /** Salta o relógio (ex.: meia-noite entre dois turnos, CF-21). */
  | { role: 'clock'; setMs: number }
  | { role: 'setup'; note: string }

/** Verificações da resposta do agente a um turno (0 = primeiro turno da cliente). */
export type TurnExpect = { turn: number; matches?: RegExp[]; excludes?: RegExp[] }

export type DialogCase = {
  id: string
  title: string
  /** Turnos ideais do agente (matriz T*). */
  turnosIdeais: number
  turns: DialogTurn[]
  /**
   * Falha conhecida (achado CF/CA): o caso TEM de falhar enquanto o achado existir.
   * Se passar, o CI falha até se remover a marca. INV-01 (marcação) bloqueia sempre.
   */
  knownFailure?: string
  /**
   * O harness ainda não consegue julgar este caso (precisa de L2/L3). Corre só as
   * invariantes de segurança e fica fora da contagem de passes.
   */
  pendingHarness?: string
  /** Prepara o cenário (ex.: bloquear a agenda) antes do primeiro turno. */
  prepare?: (s: DialogScenario) => void
  /** Já coberto por outro teste; o harness só regista o ID. */
  coverageOnly?: string
  /** Adaptador opcional (timeout, texto fixo…). */
  adapter?: AiProviderAdapter
  /** Relógio do cenário (ex. G-10 sábado 17:00). */
  nowMs?: number
  /** Asserções extra além das INV. */
  expect?: {
    outboundIncludes?: string[]
    outboundExcludes?: RegExp[]
    proposal?: boolean
    /** Chave em `scenario.ids` da profissional da proposta (CF-20 / D-06). */
    professionalKey?: 'ana' | 'bia' | 'gi' | 'sandra'
    noAppointment?: boolean
    /** Número exato de mensagens da clínica (inclui cartão da proposta). */
    outboundCount?: number
    /** Proposta mais recente no dia/hora civis da clínica. */
    proposalAt?: { date: string; time: string }
    /** Resposta do agente a um turno específico. */
    turns?: TurnExpect[]
    paused?: boolean
    notPaused?: boolean
    /** DEC-114: pausa sem mensagem automática (excepção INV-09). */
    silentPause?: boolean
  }
}

export type DialogStatus = 'pass' | 'known_failure' | 'pending' | 'covered' | 'fail'

export type DialogRunResult = {
  id: string
  /** Verde = invariantes e expectativas cumpridas. */
  ok: boolean
  status?: DialogStatus
  knownFailure?: string
  pendingHarness?: string
  invariants: InvResult[]
  /** Expectativas do caso que falharam (além das invariantes). */
  expectErrors?: string[]
  outbound: string[]
  proposals: number
  appointments: number
  agentTurns: number
  error?: string
}

export async function runDialogCase(c: DialogCase): Promise<DialogRunResult> {
  const s = bootDialogScenario({ adapter: c.adapter, nowMs: c.nowMs })
  c.prepare?.(s)
  let agentTurns = 0
  const perTurn: string[][] = []
  const runJob = async (messageId: string) => {
    const before = s.outboundBodies().length
    enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.conversationId, messageId }, s.clock)
    s.clock.advance(7_000)
    const out = await runDueAutoDrafts(s.db, s.caller, s.clock, {
      mode: 'synthetic',
      adapter: s.adapter,
    })
    if (out.length > 0) agentTurns += 1
    perTurn.push(s.outboundBodies().slice(before))
  }
  try {
    for (const turn of c.turns) {
      if (turn.role === 'client') await runJob(s.sayInbound(turn.text))
      else if (turn.role === 'burst') {
        let last = ''
        for (const t of turn.texts) last = s.sayInbound(t)
        await runJob(last)
      } else if (turn.role === 'clinic') s.sayOutbound(turn.text)
      else if (turn.role === 'clock') s.clock.set(turn.setMs)
    }

    const clientTurns = c.turns.filter((t) => t.role === 'client' || t.role === 'burst').length
    const invariants = checkInvariants(s, {
      eligibleTurns: c.turns.filter((t) => t.role === 'client').length + c.turns.filter((t) => t.role === 'burst').length,
      requirePause: c.expect?.paused,
      requireNoPause: c.expect?.notPaused ?? c.expect?.paused === false,
      allowSilentPause: c.expect?.silentPause,
    })
    const outbound = s.outboundBodies()
    const errors: string[] = []
    const e = c.expect

    for (const frag of e?.outboundIncludes ?? []) {
      if (!outbound.some((b) => b.includes(frag))) errors.push(`outbound sem «${frag}»`)
    }
    for (const re of e?.outboundExcludes ?? []) {
      if (outbound.some((b) => re.test(b))) errors.push(`outbound com ${re}`)
    }
    if (e?.outboundCount != null && outbound.length !== e.outboundCount) {
      errors.push(`esperava ${e.outboundCount} mensagem(ns), saíram ${outbound.length}`)
    }
    if (e?.proposal === true && s.proposalCount() < 1) errors.push('esperava proposta')
    if (e?.proposal === false && s.proposalCount() > 0) errors.push('proposta inesperada')
    if (e?.professionalKey) {
      const want = s.ids[e.professionalKey]
      const pro = s.db.get<{ professional_id: string | null }>(
        `SELECT professional_id FROM appointment_proposals
         WHERE tenant_id = ? AND conversation_id = ? ORDER BY version DESC LIMIT 1`,
        s.tenantId,
        s.conversationId,
      )
      if (!pro?.professional_id) errors.push('esperava proposta com profissional')
      else if (pro.professional_id !== want) errors.push(`profissional ${e.professionalKey} esperada`)
    }
    if (e?.proposalAt) {
      const row = s.db.get<{ starts_at: number }>(
        `SELECT starts_at FROM appointment_proposals
         WHERE tenant_id = ? AND conversation_id = ? ORDER BY created_at DESC, version DESC LIMIT 1`,
        s.tenantId,
        s.conversationId,
      )
      if (!row) errors.push('esperava proposta')
      else {
        const d = new Date(row.starts_at)
        const date = d.toLocaleDateString('en-CA', { timeZone: DIALOG_TZ })
        const time = d.toLocaleTimeString('pt-BR', { timeZone: DIALOG_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        if (date !== e.proposalAt.date || time !== e.proposalAt.time) {
          errors.push(`proposta em ${date} ${time}, esperada ${e.proposalAt.date} ${e.proposalAt.time}`)
        }
      }
    }
    for (const t of e?.turns ?? []) {
      if (t.turn >= clientTurns) {
        errors.push(`turno ${t.turn} não existe`)
        continue
      }
      const said = (perTurn[t.turn] ?? []).join('\n')
      for (const re of t.matches ?? []) if (!re.test(said)) errors.push(`turno ${t.turn} sem ${re}; saiu «${said.slice(0, 120)}»`)
      for (const re of t.excludes ?? []) if (re.test(said)) errors.push(`turno ${t.turn} com ${re}`)
    }

    // INV-06 só conta quando o caso declara pausa; as outras são sempre avaliadas.
    const checked = invariants.filter((i) => i.id !== 'INV-06' || e?.paused != null || e?.notPaused)
    const failedInv = checked.filter((i) => !i.ok)
    for (const f of failedInv) errors.push(`${f.id}${f.detail ? ` (${f.detail})` : ''}`)

    return {
      id: c.id,
      ok: errors.length === 0,
      knownFailure: c.knownFailure,
      pendingHarness: c.pendingHarness,
      invariants,
      expectErrors: errors,
      outbound,
      proposals: s.proposalCount(),
      appointments: s.appointmentCount(),
      agentTurns,
      error: errors.length ? errors.join('; ') : undefined,
    }
  } catch (err) {
    return {
      id: c.id,
      ok: false,
      knownFailure: c.knownFailure,
      pendingHarness: c.pendingHarness,
      invariants: [],
      outbound: s.outboundBodies(),
      proposals: s.proposalCount(),
      appointments: s.appointmentCount(),
      agentTurns,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    s.close()
  }
}

export function formatDialogReport(results: DialogRunResult[]): string {
  const by = (st: DialogStatus) => results.filter((r) => r.status === st)
  const pass = by('pass')
  const known = by('known_failure')
  const pending = by('pending')
  const covered = by('covered')
  const bad = by('fail')
  const lines = [
    `diálogos L1: ${results.length} casos`,
    `  executados e verificados (passam): ${pass.length}`,
    `  falhas conhecidas confirmadas (it.fails): ${known.length}`,
    `  pendentes de harness (só segurança): ${pending.length}`,
    `  cobertos por outro teste (não executados aqui): ${covered.length}`,
    `  falhas inesperadas: ${bad.length}`,
  ]
  for (const r of bad) lines.push(`  !! ${r.id}: ${r.error}`)
  for (const r of known) lines.push(`  · ${r.id} → ${r.knownFailure}: ${(r.error ?? '').slice(0, 110)}`)
  for (const r of pending) lines.push(`  ? ${r.id} → ${r.pendingHarness}`)
  return lines.join('\n')
}
