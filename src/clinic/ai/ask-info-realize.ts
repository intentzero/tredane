/**
 * Realização de `ask_info` como política (DEC-C1/C4 / arquitectura P1).
 *
 * O acto decide o comportamento; `sayAct` só redige. Usado pelo gate de turno
 * (caminho preferido mid-funnel) e por `catalogReply` (frios / testes unitários).
 *
 * Contrato: **não** grava variante (D4 / applyBookingUpdate `ask_info`);
 * empilha a obrigação, cotiza, retoma (DEC-C1).
 */
import { formatBRL } from '../../ai/prompt'
import { allowsMultipleVariants } from '../catalog/variant-selection'
import { variantAudiencesConflict } from '../config/zones'
import type { ServiceRow } from '../config/types'
import type { AskInfoTopic } from './booking-turn-gate'
import { sayAct, type DialogueActId } from './dialogue-acts'
import {
  parkFromFrame,
  parkInterrupt,
  emptyInterruptStack,
  popInterrupt,
  resumeParkedObligation,
  shouldResumeSlotAsk,
  shouldResumeVariantAsk,
  type DialogueInterruptStack,
  type ParkedInterrupt,
} from './dialogue-interrupt-stack'
import type { BookingFrame } from './schedule-session'
import {
  formatVariantPriceTable,
  variantKindForAsk,
  variantListQuestion,
  variantTipoWord,
  whichKind,
} from './variant-line'

export type AskInfoPolicyAct = {
  act: DialogueActId
  vars: Record<string, string>
  fallback: string
}

export type AskInfoRealizeInput = {
  conversationId: string
  topic: AskInfoTopic
  service: ServiceRow
  /** Pool activo (já filtrado por audiência quando aplicável). */
  zones: readonly ServiceRow['zones'][number][]
  frame: BookingFrame | null
  /**
   * Variantes nomeadas neste turno (ex. «quanto custa axila»).
   * Sem nomes → cotar o que está no quadro / tabela do serviço.
   */
  namedZones?: readonly ServiceRow['zones'][number][]
  /** Funil activo = sessão do mesmo serviço. */
  sameFunnel?: boolean
}

export type AskInfoRealizeResult = {
  quote: AskInfoPolicyAct
  resume: AskInfoPolicyAct | null
  replyText: string
  parked: ParkedInterrupt
  /** Pilha após pop (vazia no caminho feliz do mesmo turno). */
  stack: DialogueInterruptStack
  /** Obrigação retomada (identidade). */
  resumedObligation: ReturnType<typeof resumeParkedObligation>
}

/**
 * Realiza o acto escolhido pela política. Call-sites com id literal
 * (varredura #448); `sayAct` só redige.
 */
function renderAct(decision: AskInfoPolicyAct, conversationId: string): string {
  switch (decision.act) {
    case 'informar_preco_variante':
      return sayAct('informar_preco_variante', conversationId, decision.vars, decision.fallback)
    case 'informar_preco_soma':
      return sayAct('informar_preco_soma', conversationId, decision.vars, decision.fallback)
    case 'informar_preco_tabela':
      return sayAct('informar_preco_tabela', conversationId, decision.vars, decision.fallback)
    case 'informar_duracao':
      return sayAct('informar_duracao', conversationId, decision.vars, decision.fallback)
    case 'perguntar_horario':
      return sayAct('perguntar_horario', conversationId, decision.vars, decision.fallback)
    case 'perguntar_variantes':
      return sayAct('perguntar_variantes', conversationId, decision.vars, decision.fallback)
    case 'esclarecer':
      return sayAct('esclarecer', conversationId, decision.vars, decision.fallback)
    default:
      return sayAct(decision.act, conversationId, decision.vars, decision.fallback)
  }
}

function quoteSingleVariant(zone: ServiceRow['zones'][number]): AskInfoPolicyAct {
  const preço = zone.priceCents == null ? 'a equipe confirma o valor' : formatBRL(zone.priceCents)
  const duração = String(zone.durationMinutes)
  return {
    act: 'informar_preco_variante',
    vars: { variante: zone.name, preço, duração },
    fallback: `${zone.name} custa ${preço} e dura ${duração} min.`,
  }
}

function quoteSum(
  zones: readonly ServiceRow['zones'][number][],
): AskInfoPolicyAct {
  const minutes = zones.reduce((n, z) => n + z.durationMinutes, 0)
  const missing = zones.some((z) => z.priceCents == null)
  const cents = zones.reduce((n, z) => n + (z.priceCents ?? 0), 0)
  const preço = missing ? 'a equipe confirma o valor' : formatBRL(cents)
  const duração = String(minutes)
  return {
    act: 'informar_preco_soma',
    vars: { preço, duração },
    fallback: `No total, ficam ${preço} e ${duração} min de atendimento.`,
  }
}

function quoteTableWithAsk(
  service: ServiceRow,
  pool: readonly ServiceRow['zones'][number][],
): AskInfoPolicyAct {
  const lista = formatVariantPriceTable(pool)
  const kind = variantKindForAsk(service)
  const single = !allowsMultipleVariants(service.variantSelection)
  const pergunta = single
    ? `${whichKind(kind)} você quer?`
    : `${whichKind(kind)} você quer? Pode ser mais de uma.`
  return {
    act: 'informar_preco_tabela',
    vars: {
      serviço: service.name,
      lista,
      pergunta,
      tipo: variantTipoWord(kind),
    },
    fallback: `Para ${service.name}:\n${lista}\n${pergunta}`,
  }
}

function resumeHorario(serviceName: string): AskInfoPolicyAct {
  return {
    act: 'perguntar_horario',
    vars: { serviço: serviceName },
    fallback: `Qual horário fica melhor para ${serviceName}?`,
  }
}

/**
 * Realiza `ask_info` mid-funnel: park → quote → resume.
 * Devolve null quando o contexto não chega para cotar (cede ao frio / listagem).
 */
export function realizeAskInfo(input: AskInfoRealizeInput): AskInfoRealizeResult | null {
  const { conversationId, topic, service, zones, frame } = input
  const sameFunnel = input.sameFunnel ?? Boolean(frame?.serviceId === service.id)
  if (!sameFunnel || !frame?.serviceId) return null

  let stack = emptyInterruptStack()
  const parked = parkFromFrame(frame, 'ask_info', topic)
  stack = parkInterrupt(stack, parked)

  const named = input.namedZones ?? []
  const sessionIds = frame.variantIds ?? []
  const sessionZones =
    sessionIds.length > 0 ? zones.filter((z) => sessionIds.includes(z.id)) : []
  const sessionKept = sessionIds.length > 0 && sessionZones.length === sessionIds.length

  // Duração: resposta curta; resume igual ao preço.
  if (topic === 'duration' && named.length === 0 && sessionKept && sessionZones.length === 1) {
    const z = sessionZones[0]!
    const duração = String(z.durationMinutes)
    const quote: AskInfoPolicyAct = {
      act: 'informar_duracao',
      vars: { duração },
      fallback: `${duração} min.`,
    }
    const resume = shouldResumeSlotAsk(parked) ? resumeHorario(service.name) : null
    const { entry, stack: after } = popInterrupt(stack)
    const resumedObligation = entry ? resumeParkedObligation(entry) : null
    const quoteText = renderAct(quote, conversationId)
    const replyText = resume
      ? `${quoteText}\n${renderAct(resume, conversationId)}`
      : quoteText
    return {
      quote,
      resume,
      replyText,
      parked,
      stack: after,
      resumedObligation,
    }
  }

  if (topic !== 'price' && topic !== 'duration') {
    // catálogo / outros: não realizados aqui (DEC-142 / catalog-consult).
    const { stack: after } = popInterrupt(stack)
    void after
    return null
  }

  // Nomes no turno → cotar esses (sem gravar variante — caller não grava).
  if (named.length === 1) {
    const quote = quoteSingleVariant(named[0]!)
    const { entry, stack: after } = popInterrupt(stack)
    return {
      quote,
      resume: null,
      replyText: renderAct(quote, conversationId),
      parked,
      stack: after,
      resumedObligation: entry ? resumeParkedObligation(entry) : null,
    }
  }
  if (named.length >= 2) {
    if (variantAudiencesConflict(named)) return null
    const quote = quoteSum(named)
    const { entry, stack: after } = popInterrupt(stack)
    return {
      quote,
      resume: null,
      replyText: renderAct(quote, conversationId),
      parked,
      stack: after,
      resumedObligation: entry ? resumeParkedObligation(entry) : null,
    }
  }

  // Sem nomes: cotar o quadro aberto.
  const quoteZones = sessionKept && sessionZones.length > 0 ? sessionZones : null
  if (quoteZones && quoteZones.length === 1) {
    const quote = quoteSingleVariant(quoteZones[0]!)
    const resume = shouldResumeSlotAsk(parked) ? resumeHorario(service.name) : null
    const { entry, stack: after } = popInterrupt(stack)
    const quoteText = renderAct(quote, conversationId)
    const replyText = resume
      ? `${quoteText}\n${renderAct(resume, conversationId)}`
      : quoteText
    return {
      quote,
      resume,
      replyText,
      parked,
      stack: after,
      resumedObligation: entry ? resumeParkedObligation(entry) : null,
    }
  }
  if (quoteZones && quoteZones.length >= 2) {
    if (variantAudiencesConflict(quoteZones)) return null
    const quote = quoteSum(quoteZones)
    const resume = shouldResumeSlotAsk(parked) ? resumeHorario(service.name) : null
    const { entry, stack: after } = popInterrupt(stack)
    const quoteText = renderAct(quote, conversationId)
    const replyText = resume
      ? `${quoteText}\n${renderAct(resume, conversationId)}`
      : quoteText
    return {
      quote,
      resume,
      replyText,
      parked,
      stack: after,
      resumedObligation: entry ? resumeParkedObligation(entry) : null,
    }
  }

  // Serviço aberto sem variante (ask-tipo / «Quais zonas?»): tabela + re-pergunta.
  // A re-pergunta vive no mesmo acto `informar_preco_tabela` (resume embutido).
  if (zones.length > 0 && shouldResumeVariantAsk(parked)) {
    const quote = quoteTableWithAsk(service, zones)
    const { entry, stack: after } = popInterrupt(stack)
    return {
      quote,
      resume: null, // pergunta já no template do acto
      replyText: renderAct(quote, conversationId),
      parked,
      stack: after,
      resumedObligation: entry ? resumeParkedObligation(entry) : null,
    }
  }

  // E-02 frio-ish: serviço aberto mas sem pool — pede variantes sem R$.
  if (zones.length === 0) {
    const { stack: after } = popInterrupt(stack)
    void after
    return null
  }

  // Fallback: listagem de variantes (sem cotação) — cede ao catalogReply frio.
  const listQ = variantListQuestion(
    service.name,
    variantKindForAsk(service),
    zones,
    conversationId,
    { selectionMode: service.variantSelection },
  )
  const quote: AskInfoPolicyAct = {
    act: 'perguntar_variantes',
    vars: {
      serviço: service.name,
      tipo: variantTipoWord(variantKindForAsk(service)),
      lista: listQ,
    },
    fallback: listQ,
  }
  const { entry, stack: after } = popInterrupt(stack)
  return {
    quote,
    resume: null,
    replyText: listQ,
    parked,
    stack: after,
    resumedObligation: entry ? resumeParkedObligation(entry) : null,
  }
}

/**
 * Esclarecer mid-funnel: park → acto `esclarecer` → resume (pending intacta).
 * Política: não option-miss; não limpa variante (DEC-C3 / A-37).
 */
export function realizeClarify(input: {
  conversationId: string
  frame: BookingFrame | null
}): { replyText: string; parked: ParkedInterrupt; resumedObligation: ReturnType<typeof resumeParkedObligation> } {
  let stack = emptyInterruptStack()
  const parked = parkFromFrame(input.frame, 'clarify')
  stack = parkInterrupt(stack, parked)
  const decision: AskInfoPolicyAct = {
    act: 'esclarecer',
    vars: {},
    fallback: 'Pode me dizer de outro jeito, ou prefere falar com a equipe?',
  }
  const { entry, stack: after } = popInterrupt(stack)
  void after
  return {
    replyText: renderAct(decision, input.conversationId),
    parked,
    resumedObligation: entry ? resumeParkedObligation(entry) : null,
  }
}
