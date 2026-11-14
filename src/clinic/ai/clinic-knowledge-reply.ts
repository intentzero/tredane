/**
 * Resposta determinística a FAQ institucional (DEC-185, modo A).
 * Sem LLM; texto aprovado; mid-funnel park/resume via ask_info knowledge.
 */
import type { ClinicDb } from '../store'
import {
  matchPublishedKnowledge,
  type KnowledgeEntry,
} from '../config/knowledge'
import { foldFaqText } from './faq-clarification'

/** Acto de diálogo estável para telemetria / L1 (copy = texto cadastrado). */
export const CLINIC_KNOWLEDGE_ACT = 'informar_conhecimento_clinica' as const

export type ClinicKnowledgeHit = {
  entry: KnowledgeEntry
  replyText: string
}

/**
 * Heurística leve: parece pergunta institucional (não só escolha de zona).
 * O match de cues é a fonte de verdade; isto evita disparar em tokens soltos.
 */
export function looksLikeKnowledgeAsk(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (/\?\s*$/.test(t)) return true
  const folded = foldFaqText(t)
  return /\b(tem|têm|temos|aceita|aceitam|como|onde|posso|da\s+para|dá\s+para|voces|vocês|vcs)\b/i.test(
    folded,
  )
}

/**
 * Se houver entrada published que case, devolve o texto aprovado (modo A).
 */
export function answerClinicKnowledge(
  db: ClinicDb,
  tenantId: string,
  text: string,
): ClinicKnowledgeHit | null {
  if (!looksLikeKnowledgeAsk(text) && !hasLikelyCue(text)) return null
  const entry = matchPublishedKnowledge(db, tenantId, text)
  if (!entry) return null
  return { entry, replyText: entry.answer.trim() }
}

function hasLikelyCue(text: string): boolean {
  // Deixa o match decidir; aqui só evita short-circuit em lixo.
  return foldFaqText(text).length >= 4
}
