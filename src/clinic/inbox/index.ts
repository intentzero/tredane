export type {
  AssignConversationInput,
  CloseConversationInput,
  ContactSummary,
  ConversationDetail,
  ConversationListItem,
  ConversationRow,
  InboxCounts,
  ListConversationsInput,
  ListMessagesInput,
  MarkReadInput,
  MessageRow,
  MessagingWindowView,
  SendOutboundInput,
  SendOutboundTemplateInput,
} from './types'

export {
  appendInboundToConversation,
  applyOutboundSendResultOp,
  assignConversationOp,
  closeConversationOp,
  getContactDetailOp,
  getConversationDetailOp,
  listConversationsOp,
  markConversationReadOp,
  reconcileOutboundStatusOp,
  sendOutboundMessageOp,
  type InboxMutationResult,
} from './operations'

export { seedSyntheticInboxOp } from './seed'

export {
  getConversation,
  getConversationWithContact,
  listConversations,
  requireConversation,
} from './conversations'

export { listMessages, findMessageByExternalId } from './messages'

export {
  findOutboundByClientRequestId,
  findOutboundByProviderMessageId,
  canAdvanceDelivery,
  mapMetaStatusToDelivery,
  type OutboundMessageRow,
} from './outbound'

export {
  listWhatsappTemplates,
  seedSyntheticWhatsappTemplates,
  upsertWhatsappTemplates,
  validateTemplateSend,
  SYNTHETIC_WHATSAPP_TEMPLATES,
  type WhatsappTemplateRow,
} from './templates'

export {
  computeMessagingWindow,
  messagingWindowForConversation,
  type MessagingWindow,
} from './window'
