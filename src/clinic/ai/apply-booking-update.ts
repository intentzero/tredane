/**
 * Actualizador único do BookingFrame (#579 / PR-C).
 *
 * Casa das regras Confirmadas #575–#578: admite / preserva / substitui / invalida
 * e decide se a proposta aberta continua confirmável. Adaptadores (texto, botão,
 * Flow, extractor) emitem intents estruturados; não escrevem slots «à mão».
 *
 * Não revoga DEC-061, DEC-104, DEC-127, DEC-128, DEC-135, DEC-137, DEC-138 nem ADR-0016.
 * Gramática completa dos intents (texto→intent) fica para PR-D.
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
 * Intents mínimos que o actualizador conhece nesta fatia (#579).
 * Novos adaptadores (PR-D) acrescentam produtores; a política fica aqui.
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

function basePatch(
  input: ApplyBookingUpdateInput,
  extra: BookingFramePatch = {},
): BookingFramePatch {
  const patch: BookingFramePatch = { ...extra }
  if (input.serviceId !== undefined && input.serviceId !== null) {
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

  // #575: sobra por resolver bloqueia proposta e NÃO limpa o conjunto já
  // resolvido — mesmo com hora casada na lista.
  if (intent.unrecognized && intent.zoneEcho !== 'skip') {
    return {
      patch: basePatch(input),
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
      patch: locked ? basePatch(input, { variantIds: prior }) : basePatch(input),
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
        patch: basePatch(input),
        proposalConfirm: 'none',
        blockProposal: true,
        resolvedVariantIds: null,
        reason: 'uma_multi',
        leftover: null,
      }
    }
    if (intent.ambiguous) {
      return {
        patch: basePatch(input),
        proposalConfirm: 'none',
        blockProposal: true,
        resolvedVariantIds: null,
        reason: 'ambiguous_variants',
        leftover: null,
      }
    }
    const next = [...intent.mentionedIds]
    return {
      patch: basePatch(input, { variantIds: next }),
      proposalConfirm: 'none',
      blockProposal: false,
      resolvedVariantIds: next,
      reason: 'variants_replaced',
      leftover: null,
    }
  }

  if (prior?.length) {
    return {
      patch: basePatch(input, { variantIds: prior }),
      proposalConfirm: 'none',
      blockProposal: false,
      resolvedVariantIds: prior,
      reason: 'variants_preserved',
      leftover: null,
    }
  }

  return {
    patch: basePatch(input),
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
    const patch = basePatch(input)
    if (restore) {
      patch.date = restore.date
      patch.time = restore.time
    }
    // Sem restore: omitir date/time = preservar o quadro actual (não gravar a
    // hora pedida sem vaga).
    return {
      patch,
      proposalConfirm: 'none',
      blockProposal: true,
      resolvedVariantIds: input.frame?.variantIds ?? null,
      reason: 'time_unavailable',
      leftover: null,
    }
  }

  const patch = basePatch(input)
  let wrote = false
  if (intent.date !== undefined) {
    patch.date = intent.date
    wrote = true
  }
  if (intent.period !== undefined) {
    patch.period = intent.period
    wrote = true
  }
  if (intent.time !== undefined) {
    patch.time = intent.time
    wrote = true
  }
  return {
    patch,
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
    patch: basePatch(input, { variantIds: next }),
    // #576: eco de substituição resolvida suspende o Confirmar anterior.
    proposalConfirm: changed ? 'suspend' : 'none',
    blockProposal: true,
    resolvedVariantIds: next,
    reason: changed ? 'substitution_suspend' : 'substitution_same',
    leftover: null,
  }
}

function extractorFill(
  input: ApplyBookingUpdateInput,
  intent: Extract<BookingUpdateIntent, { type: 'extractor_fill' }>,
): ApplyBookingUpdateResult {
  const frame = input.frame
  const c = intent.candidates
  const patch = basePatch(input)
  let dirty = false

  // #578: só preenche campo vazio. Evidência na frase já foi gate no validador;
  // aqui o actualizador recusa sobrescrever.
  if (!frame?.serviceId && c.serviceId) {
    patch.serviceId = c.serviceId
    dirty = true
  } else if (frame?.serviceId || input.serviceId) {
    // Mantém o serviço já no quadro / passado pelo caller; não marca dirty.
    patch.serviceId = frame?.serviceId ?? input.serviceId!
  }

  if (!frame?.line && c.line) {
    patch.line = c.line
    dirty = true
  }
  if ((!frame?.variantIds || frame.variantIds.length === 0) && c.variantIds?.length) {
    patch.variantIds = c.variantIds
    dirty = true
  }
  if (!frame?.date && c.date) {
    patch.date = c.date
    dirty = true
  }
  if (!frame?.period && c.period) {
    patch.period = c.period
    dirty = true
  }
  if (!frame?.time && c.time) {
    patch.time = c.time
    dirty = true
  }
  if (!frame?.professionalPref && c.professionalPref) {
    patch.professionalPref = c.professionalPref
    dirty = true
  }
  if (dirty && (frame?.phase === 'idle' || !frame)) {
    patch.phase = 'coletando'
  }

  return {
    patch: dirty ? patch : basePatch(input),
    proposalConfirm: 'none',
    blockProposal: false,
    resolvedVariantIds:
      (dirty && patch.variantIds) || frame?.variantIds || null,
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
        patch: basePatch(input, { variantIds: null }),
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
        patch: basePatch(input, { serviceId: intent.serviceId }),
        proposalConfirm: 'none',
        blockProposal: false,
        resolvedVariantIds: null,
        reason: 'service_set',
        leftover: null,
      }
    case 'set_audience_line':
      return {
        patch: basePatch(input, { line: intent.line }),
        proposalConfirm: 'none',
        blockProposal: false,
        resolvedVariantIds: input.frame?.variantIds ?? null,
        reason: 'line_set',
        leftover: null,
      }
    default: {
      const _exhaustive: never = intent
      void _exhaustive
      return {
        patch: basePatch(input),
        proposalConfirm: 'none',
        blockProposal: false,
        resolvedVariantIds: input.frame?.variantIds ?? null,
        reason: 'variants_preserved',
        leftover: null,
      }
    }
  }
}
