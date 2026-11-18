/**
 * Runner L1: aplica turnos inbound via enqueueAutoDraft + runDueAutoDrafts (#406).
 */
import type { AiProviderAdapter } from '../../../../ai'
import { readZoneSnapshots } from '../../../config/zones'
import { APPOINTMENT_PROPOSAL_VALIDITY_MS } from '../../../constants'
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
import { createClientWebHarness } from './clientweb-driver'

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
   * Ação da owner no painel entre turnos (ex.: gravar sinónimo sugerido, DEC-141).
   * Corre as mesmas operações que as rotas; falha o caso se lançar.
   */
  | { role: 'owner'; note: string; act: (s: DialogScenario) => void }

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
  /** Pausa da owner no atendimento automático (DEC-061/DEC-202): o chat passa à equipe. */
  ownerPaused?: boolean
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
    /** Nº exacto de compromissos no fim (ex. 1 depois de um Confirmar válido). */
    appointments?: number
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
    /** DEC-157: conversa na fila Para revisão (`conversations.review_flagged_at`). */
    reviewFlagged?: boolean
    /** Fonte da flag de revisão (`client` | `staff` | `auto`). */
    reviewFlagSource?: 'client' | 'staff' | 'auto'
    /** DEC-166: comentário livre no 1.º «avaliar»/«feedback»; `null` = bare keyword. */
    reviewFlagClientComment?: string | null
    /**
     * `ai.turn_decided` (CA-09, DEC-143): campos esperados por evento, pela ordem dos turnos da
     * cliente que o autodraft decidiu. Só os campos nomeados são comparados (sem texto da conversa).
     */
    turnDecided?: Array<
      Partial<
        Pick<
          import('../../turn-decided').TurnDecidedPayload,
          | 'route'
          | 'variantsChanged'
          | 'zonesAskedBefore'
          | 'pendingSlotBefore'
          | 'modelCalled'
          | 'sessionId'
          | 'step'
          | 'friction'
        >
      >
    >
    /** Família GU-: quantos botões «Abrir agenda» saíram no diálogo (e com URL https de token). */
    clientWebOffers?: number
    /** Família GU-: nenhuma mensagem leva o botão de URL. */
    noCtaUrl?: boolean
    /**
     * Família GU-: propósito (e, quando se pede, marcação ou serviço alvo) de cada link emitido,
     * pela ordem.
     */
    clientWebPurposes?: Array<{
      purpose: string
      appointmentId?: string | null
      serviceId?: string | null
      audienceLine?: 'feminino' | 'masculino' | null
      variantIds?: string[]
    }>
    /** Equipe avisada: há alerta «Precisa de alguém» aberto nesta conversa (DEC-202: pausa/sem link). */
    teamAlert?: boolean
    /**
     * Zonas (nomes) que a proposta deve incluir — usado nos casos da sonda
     * (nenhuma zona cai em silêncio).
     */
    proposalZones?: string[]
    /**
     * Asserções ad-hoc sobre o cenário (ex.: payload interactive da lista Horários).
     * Devolve mensagens de erro; lista vazia = ok.
     */
    assert?: (s: DialogScenario) => string[]
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
  const baselineAppointments = s.appointmentCount()
  // DEC-202: a página está sempre ligada; o harness emite os links em memória.
  const clientWeb = createClientWebHarness()
  const webDeps = {
    prepareClientWebOffer: clientWeb.prepareOffer,
    clinicName: 'Clínica Teste Paulo',
  }
  const confirmClicks = 0
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
      ...webDeps,
      ...(c.ownerPaused ? { autoBookPaused: true } : {}),
    })
    if (out.length > 0) agentTurns += 1
    perTurn[clientTurnIdx] = s.outboundBodies().slice(before)
    clientTurnIdx += 1
    if (turnsToConfirm == null && s.proposalCount() > proposalsBefore) {
      turnsToConfirm = agentTurns
    }
  }
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
      else if (turn.role === 'owner') turn.act(s)
    }

    const clientTurns = clientTurnIdx
    const invariants = checkInvariants(s, {
      eligibleTurns:
        c.turns.filter((t) => t.role === 'client' || t.role === 'client_media').length +
        c.turns.filter((t) => t.role === 'burst').length,
      requirePause: c.expect?.paused,
      requireNoPause: c.expect?.notPaused ?? c.expect?.paused === false,
      allowSilentPause: c.expect?.silentPause,
      confirmClicks,
      baselineAppointments,
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
    if (e?.appointments != null && s.appointmentCount() !== e.appointments) {
      errors.push(`esperava ${e.appointments} compromisso(s), há ${s.appointmentCount()}`)
    }
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
    if (e?.turnDecided) {
      const events = s.db
        .all<{ payload_json: string }>(
          `SELECT payload_json FROM outbox_events
           WHERE tenant_id = ? AND type = 'ai.turn_decided' AND aggregate_id = ?
           ORDER BY occurred_at, rowid`,
          s.tenantId,
          s.conversationId,
        )
        .map((r) => JSON.parse(r.payload_json) as Record<string, unknown>)
      e.turnDecided.forEach((want, i) => {
        const got = events[i]
        if (!got) {
          errors.push(`turn_decided #${i}: não houve evento (${events.length} no total)`)
          return
        }
        for (const [k, v] of Object.entries(want)) {
          if (k === 'friction' && Array.isArray(v)) {
            // T2: cada flag pedida tem de aparecer; campos extra no got (ex. serviceId) ok.
            const gotFriction = Array.isArray(got.friction) ? (got.friction as Record<string, unknown>[]) : []
            for (const need of v as Record<string, unknown>[]) {
              const hit = gotFriction.some((g) =>
                Object.entries(need).every(([fk, fv]) => JSON.stringify(g[fk]) === JSON.stringify(fv)),
              )
              if (!hit) {
                errors.push(
                  `turn_decided #${i}.friction: falta ${JSON.stringify(need)} em ${JSON.stringify(gotFriction)}`,
                )
              }
            }
            continue
          }
          if (JSON.stringify(got[k]) !== JSON.stringify(v)) {
            errors.push(`turn_decided #${i}.${k}: ${JSON.stringify(got[k])}, esperado ${JSON.stringify(v)}`)
          }
        }
      })
    }
    if (e?.clientWebOffers != null) {
      const sent = s.db
        .all<{ interactive_json: string | null }>(
          `SELECT interactive_json FROM outbound_messages WHERE tenant_id = ? AND interactive_json LIKE '%ctaUrl%'`,
          s.tenantId,
        )
        .map((r) => JSON.parse(r.interactive_json ?? '{}') as { ctaUrl?: { displayText?: string; url?: string } })
      if (sent.length !== e.clientWebOffers) {
        errors.push(`esperava ${e.clientWebOffers} botão(ões) «Abrir agenda», saíram ${sent.length}`)
      }
      for (const m of sent) {
        if (m.ctaUrl?.displayText !== 'Abrir agenda') errors.push(`botão de URL com texto ${JSON.stringify(m.ctaUrl?.displayText)}`)
        if (!/^https:\/\/[^/]+\/c\/cw1_[A-Za-z0-9_-]{20,}$/.test(m.ctaUrl?.url ?? '')) {
          errors.push('o botão de URL não tem a forma https://…/c/<token>')
        }
      }
      if (clientWeb.offers() !== e.clientWebOffers) {
        errors.push(`esperava ${e.clientWebOffers} link(s) emitido(s), emitidos ${clientWeb.offers()}`)
      }
    }
    if (e?.clientWebPurposes) {
      const got = clientWeb.issued()
      if (JSON.stringify(got.map((g) => g.purpose)) !== JSON.stringify(e.clientWebPurposes.map((w) => w.purpose))) {
        errors.push(
          `propósitos dos links: ${JSON.stringify(got.map((g) => g.purpose))}, esperado ${JSON.stringify(e.clientWebPurposes.map((w) => w.purpose))}`,
        )
      }
      e.clientWebPurposes.forEach((w, i) => {
        if (w.appointmentId !== undefined && got[i]?.appointmentId !== w.appointmentId) {
          errors.push(`link #${i}: marcação alvo ${JSON.stringify(got[i]?.appointmentId)}, esperado ${JSON.stringify(w.appointmentId)}`)
        }
        if (w.serviceId !== undefined) {
          // O caso nomeia o serviço pelo nome do cadastro; resolve-se para o id do cenário.
          const wantId = w.serviceId
            ? (s.db.get<{ id: string }>(
                `SELECT id FROM services WHERE tenant_id = ? AND name = ?`,
                s.tenantId,
                w.serviceId,
              )?.id ?? `(serviço «${w.serviceId}» inexistente)`)
            : null
          if ((got[i]?.serviceId ?? null) !== wantId) {
            errors.push(`link #${i}: serviço alvo ${JSON.stringify(got[i]?.serviceId)}, esperado ${JSON.stringify(w.serviceId)}`)
          }
        }
        if (w.audienceLine !== undefined && (got[i]?.audienceLine ?? null) !== w.audienceLine) {
          errors.push(
            `link #${i}: linha ${JSON.stringify(got[i]?.audienceLine)}, esperado ${JSON.stringify(w.audienceLine)}`,
          )
        }
        if (w.variantIds !== undefined) {
          const gotZones = got[i]?.variantIds ?? []
          if (JSON.stringify(gotZones) !== JSON.stringify(w.variantIds)) {
            errors.push(`link #${i}: zonas ${JSON.stringify(gotZones)}, esperado ${JSON.stringify(w.variantIds)}`)
          }
        }
      })
    }
    if (e?.noCtaUrl) {
      const n = s.db
        .all<{ n: number }>(`SELECT COUNT(*) AS n FROM outbound_messages WHERE tenant_id = ? AND interactive_json LIKE '%ctaUrl%'`, s.tenantId)[0]?.n ?? 0
      if (n > 0) errors.push(`não devia haver botão de URL, saíram ${n}`)
    }
    if (e?.teamAlert != null) {
      const open = s.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM conversations
         WHERE tenant_id = ? AND id = ? AND ai_reply_paused_at IS NOT NULL`,
        s.tenantId,
        s.conversationId,
      )!.n
      if ((open > 0) !== e.teamAlert) errors.push(`teamAlert: ${open > 0}, esperado ${e.teamAlert}`)
    }
    if (
      e?.reviewFlagged != null ||
      e?.reviewFlagSource != null ||
      e?.reviewFlagClientComment !== undefined
    ) {
      const row = s.db.get<{
        review_flagged_at: number | null
        review_flagged_source: string | null
        review_client_comment: string | null
      }>(
        `SELECT review_flagged_at, review_flagged_source, review_client_comment
         FROM conversations
         WHERE tenant_id = ? AND id = ?`,
        s.tenantId,
        s.conversationId,
      )
      const flagged = row?.review_flagged_at != null
      if (e.reviewFlagged != null && flagged !== e.reviewFlagged) {
        errors.push(`reviewFlagged: ${flagged}, esperado ${e.reviewFlagged}`)
      }
      if (e.reviewFlagSource != null && row?.review_flagged_source !== e.reviewFlagSource) {
        errors.push(
          `reviewFlagSource: ${JSON.stringify(row?.review_flagged_source)}, esperado ${JSON.stringify(e.reviewFlagSource)}`,
        )
      }
      if (e.reviewFlagClientComment !== undefined) {
        const got =
          typeof row?.review_client_comment === 'string' &&
          row.review_client_comment.trim() !== ''
            ? row.review_client_comment.trim()
            : null
        if (got !== e.reviewFlagClientComment) {
          errors.push(
            `reviewFlagClientComment: ${JSON.stringify(got)}, esperado ${JSON.stringify(e.reviewFlagClientComment)}`,
          )
        }
      }
    }
    if (e?.assert) {
      for (const msg of e.assert(s)) errors.push(msg)
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
