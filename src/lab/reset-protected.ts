/**
 * Proteções obrigatórias de `lab_reset` na Clínica Teste Paulo (staging).
 * Sem números reais no repositório — waIds extra vêm de `LAB_RESET_PROTECTED_WAIDS`.
 */
import {
  DEMO_CLINIC_TENANT_ID,
  STAGING_TESTE_PAULO_TENANT_ID,
} from '../clinic/demo/ids'
import type { ClinicDb } from '../clinic/store'
import { LAB_WA_ID_RE } from './gate'

export const LAB_RESET_ALLOWED_TENANT_IDS = [
  DEMO_CLINIC_TENANT_ID,
  STAGING_TESTE_PAULO_TENANT_ID,
] as const

/** Opaque ids fixos (staging Teste Paulo) — não são PII. */
export const PAULO_PROTECTED_CONTACT_IDS: readonly string[] = ['ctc_3f67248ef72c4cec']
export const PAULO_PROTECTED_CONVERSATION_IDS: readonly string[] = ['cnv_03fdb29c9bf54af7']

export type LabResetProtectionEnv = { LAB_RESET_PROTECTED_WAIDS?: string } | undefined

export type LabResetProtection = {
  tenantRequiresEvaluation: boolean
  contactIds: Set<string>
  conversationIds: Set<string>
  waIds: Set<string>
}

export class LabResetProtectionError extends Error {
  readonly code = 'lab_reset_protection_failed'
  constructor(message: string) {
    super(message)
    this.name = 'LabResetProtectionError'
  }
}

/** `null` = fail-closed (não avaliar / abortar Teste Paulo). */
export function resolveLabResetProtection(
  tenantId: string,
  env: LabResetProtectionEnv,
): LabResetProtection | null {
  if (tenantId !== STAGING_TESTE_PAULO_TENANT_ID) {
    return {
      tenantRequiresEvaluation: false,
      contactIds: new Set(),
      conversationIds: new Set(),
      waIds: new Set(),
    }
  }
  const contactIds = new Set(PAULO_PROTECTED_CONTACT_IDS)
  const conversationIds = new Set(PAULO_PROTECTED_CONVERSATION_IDS)
  const waIds = new Set<string>()
  const raw = env?.LAB_RESET_PROTECTED_WAIDS
  if (raw === undefined || raw === '') {
    return { tenantRequiresEvaluation: true, contactIds, conversationIds, waIds }
  }
  if (typeof raw !== 'string') return null
  for (const part of raw.split(',')) {
    const token = part.trim()
    if (!token) return null
    if (!LAB_WA_ID_RE.test(token)) return null
    waIds.add(token)
  }
  return { tenantRequiresEvaluation: true, contactIds, conversationIds, waIds }
}

export function enrichProtectionFromDb(
  db: ClinicDb,
  tenantId: string,
  base: LabResetProtection,
): LabResetProtection | null {
  try {
    for (const waId of base.waIds) {
      const row = db.get<{ id: string }>(
        `SELECT id FROM contacts WHERE tenant_id = ? AND wa_id = ?`,
        tenantId,
        waId,
      )
      if (row?.id) base.contactIds.add(row.id)
    }
    for (const contactId of PAULO_PROTECTED_CONTACT_IDS) {
      const convs = db.all<{ id: string }>(
        `SELECT id FROM conversations WHERE tenant_id = ? AND contact_id = ?`,
        tenantId,
        contactId,
      )
      for (const c of convs) base.conversationIds.add(c.id)
    }
    return base
  } catch {
    return null
  }
}

export function isProtectedContactId(protection: LabResetProtection, contactId: string | null | undefined): boolean {
  if (!contactId) return false
  return protection.contactIds.has(contactId)
}

export function isProtectedConversationId(
  protection: LabResetProtection,
  conversationId: string | null | undefined,
): boolean {
  if (!conversationId) return false
  return protection.conversationIds.has(conversationId)
}

export function isProtectedWaId(protection: LabResetProtection, waId: string | null | undefined): boolean {
  if (!waId) return false
  return protection.waIds.has(waId)
}

export function assertWaIdFilterAllowed(
  protection: LabResetProtection,
  waId: string,
  resolvedContactId: string | null,
  opts?: { contactHasProtectedConversation?: boolean },
): void {
  if (isProtectedWaId(protection, waId)) {
    throw new LabResetProtectionError('waId indicado está protegido; reset recusado.')
  }
  if (resolvedContactId && isProtectedContactId(protection, resolvedContactId)) {
    throw new LabResetProtectionError('Contato do waId está protegido; reset recusado.')
  }
  if (opts?.contactHasProtectedConversation) {
    throw new LabResetProtectionError('Contato com conversa protegida; reset recusado.')
  }
}