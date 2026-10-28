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
  emitAttachmentChanged,
} from './operations'

export {
  attachmentStatusLabel,
  captionFromBody,
  isMediaPlaceholderBody,
  summarizeAttachment,
  type AttachmentDisplayStatus,
} from './display'

export { mapAttachment, type AttachmentSqlRow } from './rows'
