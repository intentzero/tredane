/** Resultado da exclusão de contacto (#43 / REQ-071) — sem PII. */
export type DeleteContactResult = {
  contactId: string
  tombstoneWaId: string
  deletedMessageCount: number
  deletedAttachmentIds: string[]
  anonymizedAppointmentCount: number
  deletedConversationCount: number
  deletedOpportunityCount: number
  auditId: string
  outboxId: string
}

export type ClinicPurgeStatus = 'idle' | 'wiping' | 'wiped' | 'failed'

export type ClinicPurgeStateRow = {
  status: ClinicPurgeStatus
  lastStep: string | null
  updatedAt: number
  wipedAt: number | null
}

/** Rótulo anónimo permanente em compromissos (REQ-071). */
export const ANONYMIZED_CONTACT_LABEL = 'Contacto removido'
