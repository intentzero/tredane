/**
 * Runner L1: aplica turnos inbound via enqueueAutoDraft + runDueAutoDrafts (#406).
 */
import type { AiProviderAdapter } from '../../../../ai'
import { readZoneSnapshots } from '../../../config/zones'
import { APPOINTMENT_PROPOSAL_VALIDITY_MS } from '../../../constants'
import { insertMessage } from '../../../inbox/messages'
import { executeProposalConfirmOp } from '../../../proposals/execute-confirm'
import { handleProposalButtonClick } from '../../../proposals/buttons'
import { proposalButtonId } from '../../../proposals/render'
import { markProposalSendPending, markProposalSent } from '../../../proposals/proposals'
import { handleChoiceOfferClick } from '../../choice-offer'
import { enqueueAutoDraft, runDueAutoDrafts } from '../../index'
import { checkInvariants, type InvResult } from './invariants'
import {
  computeDamageMetrics,
  countClientCorrections,
  formatDamageReport,
  type DamageMetrics,
  type DamageRequest,
} from './damage'
import { bootDialogScenario, DIALOG_TZ, type DialogScenario } from './scenario'

export type DialogMediaKind = 'audio' | 'image' | 'document'

export type DialogTurn =
  | { role: 'client'; text: string }
  /**
   * Mensagem com anexo (CF-26 / DEC-119). Sem `caption` → só mídia (marcador + attachment).
   * Com `caption` → corpo = legenda e o anexo continua ligado (não pede texto).
   */
  | { role: 'client_media'; kind: DialogMediaKind; caption?: string }
  /** Várias bolhas seguidas antes do debounce: um único job com a última (CF-13). */
  | { role: 'burst'; texts: string[] }
  /** A clínica já tinha dito isto (conta como turno anterior, sem resposta do agente). */
  | { role: 'clinic'; text: string }
  /** Salta o relógio (ex.: meia-noite entre dois turnos, CF-21). */
  | { role: 'clock'; setMs: number }
  | { role: 'setup'; note: string }
  /**
   * Toque autenticado em lista/botão M5 (#415 / #506). Corre `handleChoiceOfferClick`
   * (não o autodraft de texto). O corpo inbound é só telemetria.
   */
  | { role: 'choice'; buttonId: string; buttonTitle?: string; body?: string }
  /** Marca a proposta aberta mais recente como `enviada` (vigência 30 min). */
  | { role: 'proposal_sent' }
  /** Clique Confirmar na proposta aberta mais recente (DEC-061). */
  | { role: 'confirm_proposal' }

export type { DamageMetrics, DamageRequest }
export { APPOINTMENT_PROPOSAL_VALIDITY_MS }

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
  /** Previsão fictícia (Tempo / DEC-077) — evita Open-Meteo no CI. */
  forecast?: import('../../../tempo/evaluate').ForecastAdapter
  /** Relógio do cenário (ex. G-10 sábado 17:00). */
  nowMs?: number
  /**
   * Pedido declarado para métricas de estrago F1-0 (#506).
   * Sem isto, o relatório omite o caso (métricas null).
   */
  damage?: DamageRequest
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
    /** Propostas abertas / substituídas no fim do diálogo (a antiga não pode ficar vigente). */
    openProposals?: number
    supersededProposals?: number
    /** Proposta mais recente no dia/hora civis da clínica. */
    proposalAt?: { date: string; time: string }
    /** Resposta do agente a um turno específico. */
    turns?: TurnExpect[]
    paused?: boolean
    notPaused?: boolean
    /** DEC-114: pausa sem mensagem automática (excepção INV-09). */
    silentPause?: boolean
    /**
     * Zonas (nomes) que a proposta deve incluir — usado nos casos da sonda
     * (nenhuma zona cai em silêncio).
     */
    proposalZones?: string[]
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
  /** Métricas de estrago quando o caso declara `damage`. */
  damage?: DamageMetrics
  error?: string
}

export type DialogScenarioFactory = (opts: {
  adapter?: AiProviderAdapter
  nowMs?: number
}) => DialogScenario

/**
 * Corre um caso L1. Por omissão usa o cenário de referência da matriz;
 * o gerador M7 (#418) pode passar outro boot (segunda clínica).
 */
export async function runDialogCase(
  c: DialogCase,
  boot: DialogScenarioFactory = bootDialogScenario,
): Promise<DialogRunResult> {
  const s = boot({ adapter: c.adapter, nowMs: c.nowMs })
  c.prepare?.(s)
  let agentTurns = 0
  let turnsToConfirm: number | null = null
  const perTurn: string[][] = []
  /** Turnos da cliente (texto/mídia/burst/choice) — índice das expectativas `turns`. */
  let clientTurnIdx = 0
  const runJob = async (messageId: string) => {
    const before = s.outboundBodies().length
    const proposalsBefore = s.proposalCount()
    enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.conversationId, messageId }, s.clock)
    s.clock.advance(7_000)
    const out = await runDueAutoDrafts(s.db, s.caller, s.clock, {
      mode: 'synthetic',
      adapter: s.adapter,
      forecast: c.forecast,
    })
    if (out.length > 0) agentTurns += 1
    perTurn[clientTurnIdx] = s.outboundBodies().slice(before)
    clientTurnIdx += 1
    if (turnsToConfirm == null && s.proposalCount() > proposalsBefore) {
      turnsToConfirm = agentTurns
    }
  }
  const latestProposal = () =>
    s.db.get<{ id: string; version: number }>(
      `SELECT id, version FROM appointment_proposals
       WHERE tenant_id = ? AND conversation_id = ?
       ORDER BY created_at DESC, version DESC LIMIT 1`,
      s.tenantId,
      s.conversationId,
    )
  try {
    for (const turn of c.turns) {
      if (turn.role === 'client') await runJob(s.sayInbound(turn.text))
      else if (turn.role === 'client_media') {
        await runJob(s.sayInboundMedia({ kind: turn.kind, caption: turn.caption }))
      } else if (turn.role === 'burst') {
        let last = ''
        for (const t of turn.texts) last = s.sayInbound(t)
        await runJob(last)
      } else if (turn.role === 'clinic') s.sayOutbound(turn.text)
      else if (turn.role === 'clock') s.clock.set(turn.setMs)
      else if (turn.role === 'choice') {
        const before = s.outboundBodies().length
        const proposalsBefore = s.proposalCount()
        s.clock.advance(1_000)
        insertMessage(
          s.db,
          {
            tenantId: s.tenantId,
            conversationId: s.conversationId,
            direction: 'inbound',
            body: turn.body ?? `[Lista] ${turn.buttonTitle ?? 'opção'}`,
            deliveryState: 'received',
            createdAt: s.clock.nowMs(),
          },
          s.clock,
        )
        const clicked = await handleChoiceOfferClick(
          s.db,
          s.caller,
          {
            tenantId: s.tenantId,
            conversationId: s.conversationId,
            buttonId: turn.buttonId,
            buttonTitle: turn.buttonTitle,
            providerEventKey: `dialog-choice:${c.id}:${clientTurnIdx}`,
          },
          s.clock,
        )
        if (clicked.handled) agentTurns += 1
        perTurn[clientTurnIdx] = s.outboundBodies().slice(before)
        clientTurnIdx += 1
        if (turnsToConfirm == null && s.proposalCount() > proposalsBefore) {
          turnsToConfirm = agentTurns
        }
      } else if (turn.role === 'proposal_sent') {
        const p = latestProposal()
        if (p) {
          markProposalSendPending(s.db, s.tenantId, p.id, s.clock)
          markProposalSent(s.db, s.tenantId, p.id, s.clock)
          s.db.run(
            `UPDATE appointment_proposals SET send_provider_message_id = ? WHERE tenant_id = ? AND id = ?`,
            `wamid.dialog.${p.id}`,
            s.tenantId,
            p.id,
          )
        }
      } else if (turn.role === 'confirm_proposal') {
        const p = latestProposal()
        const before = s.outboundBodies().length
        if (p) {
          const click = handleProposalButtonClick(
            s.db,
            {
              tenantId: s.tenantId,
              contactId: s.contactId,
              conversationId: s.conversationId,
              buttonId: proposalButtonId(p.id, p.version, 'confirm'),
              contextMessageId: `wamid.dialog.${p.id}`,
              providerEventKey: `dialog-confirm:${c.id}`,
            },
            s.clock,
          )
          if (click.handled && 'handoff' in click && click.handoff) {
            await executeProposalConfirmOp(
              s.db,
              s.caller,
              {
                handoff: click.handoff,
                capability: true,
                providerEventKey: `dialog-confirm:${c.id}`,
                contextMessageId: `wamid.dialog.${p.id}`,
              },
              s.clock,
            )
          }
          agentTurns += 1
        }
        perTurn[clientTurnIdx] = s.outboundBodies().slice(before)
        clientTurnIdx += 1
      }
    }

    const clientTurns = clientTurnIdx
    const invariants = checkInvariants(s, {
      eligibleTurns:
        c.turns.filter((t) => t.role === 'client' || t.role === 'client_media').length +
        c.turns.filter((t) => t.role === 'burst').length +
        c.turns.filter((t) => t.role === 'choice').length,
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
    const countState = (states: string) =>
      s.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM appointment_proposals WHERE tenant_id = ? AND conversation_id = ? AND state IN (${states})`,
        s.tenantId,
        s.conversationId,
      )!.n
    if (e?.openProposals != null) {
      const n = countState(`'preparada','envio_pendente','envio_incerto','enviada'`)
      if (n !== e.openProposals) errors.push(`esperava ${e.openProposals} proposta(s) aberta(s), há ${n}`)
    }
    if (e?.supersededProposals != null) {
      const n = countState(`'substituida'`)
      if (n !== e.supersededProposals) errors.push(`esperava ${e.supersededProposals} substituída(s), há ${n}`)
    }
    if (e?.proposal === true && s.proposalCount() < 1) errors.push('esperava proposta')
    if (e?.proposal === false && s.proposalCount() > 0) errors.push('proposta inesperada')
    if (e?.noAppointment === true && s.appointmentCount() > 0) {
      errors.push('compromisso inesperado')
    }
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
    if (e?.proposalZones && e.proposalZones.length > 0) {
      const row = s.db.get<{ id: string }>(
        `SELECT id FROM appointment_proposals
         WHERE tenant_id = ? AND conversation_id = ? ORDER BY created_at DESC, version DESC LIMIT 1`,
        s.tenantId,
        s.conversationId,
      )
      if (!row) errors.push('esperava proposta com zonas')
      else {
        const snaps = readZoneSnapshots(s.db, s.tenantId, 'proposal', row.id)
        const got = new Set(snaps.map((z) => z.name.trim().toLocaleLowerCase('pt-BR')))
        for (const name of e.proposalZones) {
          if (!got.has(name.trim().toLocaleLowerCase('pt-BR'))) {
            errors.push(`proposta sem zona «${name}» (tem: ${[...got].join(', ') || 'nenhuma'})`)
          }
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

    const damage =
      c.damage != null
        ? computeDamageMetrics({
            s,
            request: c.damage,
            clientCorrections: countClientCorrections(c.turns),
            turnsToConfirm,
          })
        : undefined

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
      damage,
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
  const damageBlock = formatDamageReport(results)
  if (damageBlock) lines.push(damageBlock)
  return lines.join('\n')
}
