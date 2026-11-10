/**
 * Actualizador único do BookingFrame (#579 / PR-C + PR-D).
 *
 * Casa das regras Confirmadas #575–#578: admite / preserva / substitui / invalida
 * e decide se a proposta aberta continua confirmável. Adaptadores (texto, botão,
 * Flow, extractor) emitem intents estruturados; não escrevem slots «à mão».
 *
 * Não revoga DEC-061, DEC-104, DEC-127, DEC-128, DEC-135, DEC-137, DEC-138 nem ADR-0016.
 * PR-D: ask_info, select_variants, choose_offered, commit_flow; stale Flow vs chat.
 */
import { allowsMultipleVariants, type VariantSelection } from '../catalog/variant-selection'
import type {
  BookingFrame,
  BookingFramePatch,
  ScheduleAudienceLine,
  SchedulePeriod,
} from './schedule-session'

export type BookingUpdateSource = 'text' | 'button' | 'flow' | 'extractor' | 'regra'

export type BookingUpdateEvidence = {
  source: BookingUpdateSource
  sourceMessageId?: string
}

/**
 * Intents que o actualizador conhece (#579 + PR-D).
 * compare / mention_only genérico / ask_info além de preço-duração: diferidos.
 */
export type BookingUpdateIntent =
  | {
      type: 'admit_variants'
      /** Ids já resolvidos pelo parser neste turno (vazio se só ruído / hora). */
      mentionedIds: string[]
      unrecognized: boolean
      leftover: string | null
      ambiguous: boolean
      zoneEcho?: 'skip' | 'confirm' | 'correct' | null
      /**
       * Hora já casada na lista / toque Horários.
       * NÃO autoriza ignorar sobra nem apagar o slot (#579 / anti-`slotBound`).
       */
      timeAlreadyBound?: boolean
      selectionMode: VariantSelection
      /** Conjunto intacto já no quadro (mesma linha / serviço). */
      priorVariantIds: string[] | null
    }
  | {
      type: 'admit_temporal'
      date?: string | null
      period?: SchedulePeriod | null
      time?: string | null
      /** #577: vaga do horário pedido. */
      vacancy: 'free' | 'unavailable' | 'unchecked'
      /** Relógio da proposta aberta — restaura se `unavailable`. */
      openProposalClock?: { date: string; time: string } | null
    }
  | {
      type: 'resolved_substitution_echo'
      nextVariantIds: string[]
      openProposalVariantIds: string[] | null
    }
  | { type: 'correct_echo' }
  | {
      type: 'extractor_fill'
      candidates: {
        serviceId?: string
        line?: ScheduleAudienceLine
        variantIds?: string[]
        date?: string
        period?: SchedulePeriod
        time?: string
        professionalPref?: string
      }
    }
  | { type: 'set_service'; serviceId: string }
  | { type: 'set_audience_line'; line: ScheduleAudienceLine | null }
  /** D4: consulta de preço/duração — não grava variante. */
  | {
      type: 'ask_info'
      topic: 'preco' | 'duracao' | 'catalogo' | 'local' | 'outro'
    }
  /**
   * D3 / toque: conjunto explícito com modo.
   * `remove` tira ids do prior; `add` une (só `varias`); `replace` substitui.
   */
  | {
      type: 'select_variants'
      variantIds: string[]
      mode: 'replace' | 'add' | 'remove'
      selectionMode: VariantSelection
      priorVariantIds: string[] | null
    }
  /** Toque M5 / pending de linha, variantes ou horário já resolvido. */
  | {
      type: 'choose_offered'
      slot: 'linha' | 'variantes' | 'horario'
      line?: ScheduleAudienceLine | null
      variantIds?: string[] | null
      date?: string | null
      time?: string | null
      selectionMode?: VariantSelection
    }
  /** Fecho nfm_reply com ids do Flow (ADR-0016) — carimba provenance `flow`. */
  | {
      type: 'commit_flow'
      serviceId: string
      line: ScheduleAudienceLine | null
      variantIds: string[] | null
      date: string
      time: string
    }

export type ProposalConfirmAction = 'none' | 'suspend' | 'resume'

export type ApplyBookingUpdateReason =
  | 'unresolved_variant'
  | 'echo_correct'
  | 'echo_locked'
  | 'variants_replaced'
  | 'variants_preserved'
  | 'variants_cleared'
  | 'ambiguous_variants'
  | 'uma_multi'
  | 'time_unavailable'
  | 'time_admitted'
  | 'time_preserved'
  | 'substitution_suspend'
  | 'substitution_same'
  | 'extractor_empty_only'
  | 'service_set'
  | 'line_set'
  | 'ask_info_no_select'
  | 'variants_selected'
  | 'choice_applied'
  | 'flow_committed'
  | 'stale_flow_rejected'

export type ApplyBookingUpdateResult = {
  /** Omitir campo = preservar. `null` = limpar. */
  patch: BookingFramePatch
  proposalConfirm: ProposalConfirmAction
  /** Sobra / ambiguidade / hora sem vaga — não autoriza proposta neste turno. */
  blockProposal: boolean
  /** Conjunto efectivo após a política (para o caller continuar o funil). */
  resolvedVariantIds: string[] | null
  reason: ApplyBookingUpdateReason
  leftover: string | null
}

export type ApplyBookingUpdateInput = {
  frame: BookingFrame | null
  intent: BookingUpdateIntent
  evidence: BookingUpdateEvidence
  serviceId?: string | null
  catalogVersion?: string
}

function sortedKey(ids: readonly string[] | null | undefined): string {
  return [...(ids ?? [])].sort().join('\0')
}

/**
 * Monta o patch de slots. Por omissão **não** carimba `source`/`sourceMessageId`:
 * um carimbo «regra/botao» em campos que não mudaram apagava a proveniência
 * `flow` do nfm_reply (ADR-0016 / #613 CI).
 *
 * Com `stamp: true`, carimba **só** as chaves presentes em `extra` (+ serviceId
 * se `includeServiceId` ou troca de serviço). O extrator usa `stamp`+`includeServiceId`.
 */
function basePatch(
  input: ApplyBookingUpdateInput,
  extra: BookingFramePatch = {},
  opts?: { stamp?: boolean; includeServiceId?: boolean },
): BookingFramePatch {
  const patch: BookingFramePatch = { ...extra }
  const writing = Object.keys(extra).length > 0 || opts?.includeServiceId === true
  if (!writing && !opts?.stamp) return patch

  const serviceChanging =
    input.serviceId != null && input.frame?.serviceId !== input.serviceId
  if (opts?.includeServiceId === true || (writing && serviceChanging)) {
    if (input.serviceId != null) patch.serviceId = input.serviceId
  }
  if (writing && input.catalogVersion) patch.catalogVersion = input.catalogVersion

  if (opts?.stamp && writing) {
    if (opts.includeServiceId === true && input.serviceId != null) {
      patch.serviceId = input.serviceId
    }
    if (input.catalogVersion) patch.catalogVersion = input.catalogVersion
    if (input.evidence.sourceMessageId) patch.sourceMessageId = input.evidence.sourceMessageId
    if (input.evidence.source === 'extractor') patch.source = 'llm'
    else if (input.evidence.source === 'button') patch.source = 'botao'
    else if (input.evidence.source === 'flow') patch.source = 'flow'
    else if (input.evidence.source === 'text' || input.evidence.source === 'regra') {
      patch.source = 'regra'
    }
  }
  return patch
}

function admitVariants(
  input: ApplyBookingUpdateInput,
  intent: Extract<BookingUpdateIntent, { type: 'admit_variants' }>,
): ApplyBookingUpdateResult {
  const prior = intent.priorVariantIds?.length ? [...intent.priorVariantIds] : null
  // `timeAlreadyBound` é aceite no contrato para o caller o declarar — e
  // deliberadamente ignorado na decisão de sobra (#579). Não reintroduzir
  // `if (timeAlreadyBound) skip leftover`.
  void intent.timeAlreadyBound

  if (intent.zoneEcho === 'correct') {
    return {
      patch: basePatch(input, { variantIds: null }),
      proposalConfirm: 'resume',
      blockProposal: true,
      resolvedVariantIds: null,
      reason: 'echo_correct',
      leftover: null,
    }
  }

  // #575 / Paulo 10/11/2026 opção 2: sobra bloqueia proposta; o que casou
  // neste turno une-se ao prior (não descarta o enunciado nem apaga zonas já
  // travadas). Sem menção nova, preserva prior.
  if (intent.unrecognized && intent.zoneEcho !== 'skip') {
    if (intent.mentionedIds.length > 0 && !intent.ambiguous) {
      if (!allowsMultipleVariants(intent.selectionMode) && intent.mentionedIds.length > 1) {
        return {
          patch: {},
          proposalConfirm: 'none',
          blockProposal: true,
          resolvedVariantIds: prior,
          reason: 'unresolved_variant',
          leftover: intent.leftover,
        }
      }
      const next = allowsMultipleVariants(intent.selectionMode)
        ? [...new Set([...(prior ?? []), ...intent.mentionedIds])]
        : [...intent.mentionedIds]
      if (!allowsMultipleVariants(intent.selectionMode) && next.length > 1) {
        return {
          patch: {},
          proposalConfirm: 'none',
          blockProposal: true,
          resolvedVariantIds: prior,
          reason: 'unresolved_variant',
          leftover: intent.leftover,
        }
      }
      const unchanged =
        prior != null &&
        prior.length === next.length &&
        prior.every((id, i) => id === next[i])
      return {
        patch: unchanged ? {} : basePatch(input, { variantIds: next }, { stamp: true }),
        proposalConfirm: 'none',
        blockProposal: true,
        resolvedVariantIds: next,
        reason: 'unresolved_variant',
        leftover: intent.leftover,
      }
    }
    return {
      patch: {},
      proposalConfirm: 'none',
      blockProposal: true,
      resolvedVariantIds: prior,
      reason: 'unresolved_variant',
      leftover: intent.leftover,
    }
  }

  if (intent.zoneEcho === 'confirm') {
    const locked = Boolean(prior?.length)
    return {
      // Quadro já tem o conjunto; não reescrever (preserva provenance flow).
      patch: {},
      proposalConfirm: 'none',
      blockProposal: !locked,
      resolvedVariantIds: locked ? prior : null,
      reason: locked ? 'echo_locked' : 'variants_cleared',
      leftover: null,
    }
  }

  if (intent.mentionedIds.length > 0) {
    if (!allowsMultipleVariants(intent.selectionMode) && intent.mentionedIds.length > 1) {
      return {
        patch: {},
        proposalConfirm: 'none',
        blockProposal: true,
        resolvedVariantIds: null,
        reason: 'uma_multi',
        leftover: null,
      }
    }
    if (intent.ambiguous) {
      return {
        patch: {},
        proposalConfirm: 'none',
        blockProposal: true,
        resolvedVariantIds: null,
        reason: 'ambiguous_variants',
        leftover: null,
      }
    }
    const next = [...intent.mentionedIds]
    // Carimba só quando substitui: chat/botão pós-Flow fica detectável (D6 / ADR-0016).
    return {
      patch: basePatch(input, { variantIds: next }, { stamp: true }),
      proposalConfirm: 'none',
      blockProposal: false,
      resolvedVariantIds: next,
      reason: 'variants_replaced',
      leftover: null,
    }
  }

  if (prior?.length) {
    return {
      // Preservar = não gravar de novo (evita carimbar source sobre o Flow).
      patch: {},
      proposalConfirm: 'none',
      blockProposal: false,
      resolvedVariantIds: prior,
      reason: 'variants_preserved',
      leftover: null,
    }
  }

  return {
    patch: {},
    proposalConfirm: 'none',
    blockProposal: true,
    resolvedVariantIds: null,
    reason: 'variants_cleared',
    leftover: null,
  }
}

function admitTemporal(
  input: ApplyBookingUpdateInput,
  intent: Extract<BookingUpdateIntent, { type: 'admit_temporal' }>,
): ApplyBookingUpdateResult {
  // #577: hora sem vaga não substitui a oferta. Restaura o relógio da proposta
  // aberta; Confirmar dessa proposta continua válido.
  if (intent.vacancy === 'unavailable') {
    const restore = intent.openProposalClock
    return {
      patch: restore
        ? basePatch(input, { date: restore.date, time: restore.time }, { stamp: true })
        : {},
      proposalConfirm: 'none',
      blockProposal: true,
      resolvedVariantIds: input.frame?.variantIds ?? null,
      reason: 'time_unavailable',
      leftover: null,
    }
  }

  const extra: BookingFramePatch = {}
  if (intent.date !== undefined) extra.date = intent.date
  if (intent.period !== undefined) extra.period = intent.period
  if (intent.time !== undefined) extra.time = intent.time
  const wrote = Object.keys(extra).length > 0
  return {
    patch: wrote ? basePatch(input, extra, { stamp: true }) : {},
    proposalConfirm: 'none',
    blockProposal: false,
    resolvedVariantIds: input.frame?.variantIds ?? null,
    reason: wrote ? 'time_admitted' : 'time_preserved',
    leftover: null,
  }
}

function resolvedSubstitution(
  input: ApplyBookingUpdateInput,
  intent: Extract<BookingUpdateIntent, { type: 'resolved_substitution_echo' }>,
): ApplyBookingUpdateResult {
  const next = [...intent.nextVariantIds]
  const changed =
    intent.openProposalVariantIds != null &&
    sortedKey(intent.openProposalVariantIds) !== sortedKey(next)
  return {
    patch: basePatch(input, { variantIds: next }, { stamp: true }),
    // #576: eco de substituição resolvida suspende o Confirmar anterior.
    proposalConfirm: changed ? 'suspend' : 'none',
    blockProposal: true,
    resolvedVariantIds: next,
    reason: changed ? 'substitution_suspend' : 'substitution_same',
    leftover: null,
  }
}

function selectVariants(
  input: ApplyBookingUpdateInput,
  intent: Extract<BookingUpdateIntent, { type: 'select_variants' }>,
): ApplyBookingUpdateResult {
  const prior = intent.priorVariantIds?.length ? [...intent.priorVariantIds] : []
  let next: string[]
  if (intent.mode === 'remove') {
    const drop = new Set(intent.variantIds)
    next = prior.filter((id) => !drop.has(id))
  } else if (intent.mode === 'add') {
    if (!allowsMultipleVariants(intent.selectionMode)) {
      return {
        patch: {},
        proposalConfirm: 'none',
        blockProposal: true,
        resolvedVariantIds: prior.length ? prior : null,
        reason: 'uma_multi',
        leftover: null,
      }
    }
    const seen = new Set(prior)
    next = [...prior]
    for (const id of intent.variantIds) {
      if (!seen.has(id)) {
        next.push(id)
        seen.add(id)
      }
    }
  } else {
    next = [...intent.variantIds]
  }
  if (!allowsMultipleVariants(intent.selectionMode) && next.length > 1) {
    return {
      patch: {},
      proposalConfirm: 'none',
      blockProposal: true,
      resolvedVariantIds: null,
      reason: 'uma_multi',
      leftover: null,
    }
  }
  return {
    patch: basePatch(input, { variantIds: next.length > 0 ? next : null }, { stamp: true }),
    proposalConfirm: 'none',
    blockProposal: next.length === 0,
    resolvedVariantIds: next.length > 0 ? next : null,
    reason: 'variants_selected',
    leftover: null,
  }
}

function chooseOffered(
  input: ApplyBookingUpdateInput,
  intent: Extract<BookingUpdateIntent, { type: 'choose_offered' }>,
): ApplyBookingUpdateResult {
  const extra: BookingFramePatch = { pending: null, phase: 'coletando' }
  if (intent.slot === 'linha' && intent.line !== undefined) {
    extra.line = intent.line
  }
  if (intent.slot === 'variantes') {
    const ids = intent.variantIds ?? []
    if (
      intent.selectionMode &&
      !allowsMultipleVariants(intent.selectionMode) &&
      ids.length > 1
    ) {
      return {
        patch: {},
        proposalConfirm: 'none',
        blockProposal: true,
        resolvedVariantIds: null,
        reason: 'uma_multi',
        leftover: null,
      }
    }
    extra.variantIds = ids.length > 0 ? [...ids] : null
  }
  if (intent.slot === 'horario') {
    if (intent.date !== undefined) extra.date = intent.date
    if (intent.time !== undefined) extra.time = intent.time
  }
  return {
    patch: basePatch(input, extra, { stamp: true }),
    proposalConfirm: 'none',
    blockProposal: false,
    resolvedVariantIds:
      intent.slot === 'variantes'
        ? intent.variantIds && intent.variantIds.length > 0
          ? [...intent.variantIds]
          : null
        : (input.frame?.variantIds ?? null),
    reason: 'choice_applied',
    leftover: null,
  }
}

function commitFlow(
  input: ApplyBookingUpdateInput,
  intent: Extract<BookingUpdateIntent, { type: 'commit_flow' }>,
): ApplyBookingUpdateResult {
  return {
    patch: basePatch(
      input,
      {
        serviceId: intent.serviceId,
        line: intent.line,
        variantIds: intent.variantIds,
        date: intent.date,
        time: intent.time,
        period: null,
        pending: null,
        lastOffer: null,
        phase: 'ofertado',
      },
      { stamp: true, includeServiceId: true },
    ),
    proposalConfirm: 'none',
    blockProposal: false,
    resolvedVariantIds: intent.variantIds,
    reason: 'flow_committed',
    leftover: null,
  }
}

function extractorFill(
  input: ApplyBookingUpdateInput,
  intent: Extract<BookingUpdateIntent, { type: 'extractor_fill' }>,
): ApplyBookingUpdateResult {
  const frame = input.frame
  const c = intent.candidates
  const extra: BookingFramePatch = {}
  let dirty = false

  // #578: só preenche campo vazio. Evidência na frase já foi gate no validador;
  // aqui o actualizador recusa sobrescrever.
  if (!frame?.serviceId && c.serviceId) {
    extra.serviceId = c.serviceId
    dirty = true
  }
  if (!frame?.line && c.line) {
    extra.line = c.line
    dirty = true
  }
  if ((!frame?.variantIds || frame.variantIds.length === 0) && c.variantIds?.length) {
    extra.variantIds = c.variantIds
    dirty = true
  }
  if (!frame?.date && c.date) {
    extra.date = c.date
    dirty = true
  }
  if (!frame?.period && c.period) {
    extra.period = c.period
    dirty = true
  }
  if (!frame?.time && c.time) {
    extra.time = c.time
    dirty = true
  }
  if (!frame?.professionalPref && c.professionalPref) {
    extra.professionalPref = c.professionalPref
    dirty = true
  }
  if (dirty && (frame?.phase === 'idle' || !frame)) {
    extra.phase = 'coletando'
  }

  return {
    patch: dirty
      ? basePatch(input, extra, { stamp: true, includeServiceId: true })
      : {},
    proposalConfirm: 'none',
    blockProposal: false,
    resolvedVariantIds:
      (dirty && extra.variantIds) || frame?.variantIds || null,
    reason: 'extractor_empty_only',
    leftover: null,
  }
}

/**
 * Único sítio de política do quadro para as regras #575–#578.
 * Puro: sem I/O. O caller aplica `patch` e executa `proposalConfirm`.
 */
export function applyBookingUpdate(input: ApplyBookingUpdateInput): ApplyBookingUpdateResult {
  const { intent } = input
  switch (intent.type) {
    case 'admit_variants':
      return admitVariants(input, intent)
    case 'admit_temporal':
      return admitTemporal(input, intent)
    case 'resolved_substitution_echo':
      return resolvedSubstitution(input, intent)
    case 'correct_echo':
      return {
        patch: basePatch(input, { variantIds: null }, { stamp: true }),
        proposalConfirm: 'resume',
        blockProposal: true,
        resolvedVariantIds: null,
        reason: 'echo_correct',
        leftover: null,
      }
    case 'extractor_fill':
      return extractorFill(input, intent)
    case 'set_service':
      return {
        patch: basePatch(input, { serviceId: intent.serviceId }, { includeServiceId: true }),
        proposalConfirm: 'none',
        blockProposal: false,
        resolvedVariantIds: null,
        reason: 'service_set',
        leftover: null,
      }
    case 'set_audience_line':
      return {
        patch: basePatch(input, { line: intent.line }, { stamp: true }),
        proposalConfirm: 'none',
        blockProposal: false,
        resolvedVariantIds: input.frame?.variantIds ?? null,
        reason: 'line_set',
        leftover: null,
      }
    case 'ask_info':
      return {
        patch: {},
        proposalConfirm: 'none',
        blockProposal: false,
        resolvedVariantIds: input.frame?.variantIds ?? null,
        reason: 'ask_info_no_select',
        leftover: null,
      }
    case 'select_variants':
      return selectVariants(input, intent)
    case 'choose_offered':
      return chooseOffered(input, intent)
    case 'commit_flow':
      return commitFlow(input, intent)
    default: {
      const _exhaustive: never = intent
      void _exhaustive
      return {
        patch: {},
        proposalConfirm: 'none',
        blockProposal: false,
        resolvedVariantIds: input.frame?.variantIds ?? null,
        reason: 'variants_preserved',
        leftover: null,
      }
    }
  }
}

/**
 * D6 / ADR-0016: nfm_reply não sobrescreve correção mais recente no chat.
 * Compara o snapshot do Flow com o quadro; se variantes ou relógio divergem e a
 * proveniência do campo mudado já não é `flow`, recusa o commit.
 */
export function isStaleFlowVersusChat(
  frame: BookingFrame | null,
  prepared: {
    serviceId: string
    variantIds: string[] | null
    date: string
    time: string
  },
): boolean {
  if (!frame || frame.serviceId !== prepared.serviceId) return false
  const preparedKey = sortedKey(prepared.variantIds)
  const frameKey = sortedKey(frame.variantIds)
  const variantsDiffer = preparedKey !== frameKey
  const clockDiffer = frame.date !== prepared.date || frame.time !== prepared.time
  if (!variantsDiffer && !clockDiffer) return false

  // Só texto/extrator contam como «chat» (D6). `botao` fica do funil M5/Flow
  // e não bloqueia um Flow novo noutro horário.
  const isChat = (src: string | undefined) => src === 'regra' || src === 'llm'
  if (variantsDiffer && isChat(frame.provenance?.variantIds?.source)) return true
  if (
    clockDiffer &&
    (isChat(frame.provenance?.date?.source) || isChat(frame.provenance?.time?.source))
  ) {
    return true
  }
  return false
}
