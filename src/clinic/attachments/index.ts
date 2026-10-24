export type {
  AttachmentRow,
  CreatePendingAttachmentInput,
  LinkAttachmentToMessageInput,
  MarkAttachmentFailedInput,
  MarkAttachmentReadyInput,
} from './types'

export {
  createPendingAttachmentOp,
  getAttachment,
  getAttachmentOp,
  linkAttachmentToMessageOp,
  listAttachmentsForConversation,
  listAttachmentsForMessage,
  listOrphanCandidates,
  markAttachmentFailedOp,
  markAttachmentReadyOp,
  softDeleteAttachmentOp,
  assertAttachmentOwnedByTenant,
} from './operations'

export { mapAttachment, type AttachmentSqlRow } from './rows'
