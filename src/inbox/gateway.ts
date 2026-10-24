import type { Clock } from '../db/clock'
import {
  clinicInbox,
  type ClinicCaller,
  type ClinicDb,
  workerCaller,
} from '../clinic'
import type {
  AssignConversationInput,
  CloseConversationInput,
  ConversationDetail,
  ConversationListItem,
  InboxCounts,
  ListConversationsInput,
  MarkReadInput,
  MessageRow,
  SendOutboundInput,
} from '../clinic/inbox'

export type InboxGateway = {
  listConversations(
    caller: ClinicCaller,
    input: ListConversationsInput,
  ): Promise<{
    items: ConversationListItem[]
    nextBefore: number | null
    counts: InboxCounts
  }>
  getConversation(
    caller: ClinicCaller,
    input: { conversationId: string; messageLimit?: number; before?: number | null },
  ): Promise<ConversationDetail>
  getContact(
    caller: ClinicCaller,
    contactId: string,
  ): Promise<{
    contact: ConversationListItem['contact']
    conversations: ConversationListItem[]
  }>
  assign(
    caller: ClinicCaller,
    input: AssignConversationInput,
  ): Promise<{
    conversation: ConversationListItem
    systemMessage: MessageRow
    versionMatched: boolean
  }>
  markRead(
    caller: ClinicCaller,
    input: MarkReadInput,
  ): Promise<ConversationListItem>
  close(
    caller: ClinicCaller,
    input: CloseConversationInput,
  ): Promise<{ conversation: ConversationListItem; systemMessage: MessageRow }>
  sendOutbound(
    caller: ClinicCaller,
    input: SendOutboundInput,
  ): Promise<{
    conversation: ConversationListItem
    message: MessageRow
    duplicate: boolean
  }>
  seedDemo(
    caller: ClinicCaller,
    opts?: { force?: boolean },
  ): Promise<{ seeded: boolean; conversationCount: number }>
}

export function createMemoryInboxGateway(db: ClinicDb, clock: Clock): InboxGateway {
  return {
    async listConversations(caller, input) {
      return clinicInbox.listConversationsOp(db, caller, input, clock)
    },
    async getConversation(caller, input) {
      return clinicInbox.getConversationDetailOp(db, caller, input, clock)
    },
    async getContact(caller, contactId) {
      return clinicInbox.getContactDetailOp(db, caller, contactId, clock)
    },
    async assign(caller, input) {
      return clinicInbox.assignConversationOp(db, caller, input, clock).value
    },
    async markRead(caller, input) {
      return clinicInbox.markConversationReadOp(db, caller, input, clock).value
    },
    async close(caller, input) {
      return clinicInbox.closeConversationOp(db, caller, input, clock).value
    },
    async sendOutbound(caller, input) {
      return clinicInbox.sendOutboundMessageOp(db, caller, input, clock).value
    },
    async seedDemo(caller, opts) {
      return clinicInbox.seedSyntheticInboxOp(db, caller, clock, opts)
    },
  }
}

export function createMemoryInboxRegistry(
  getDb: (tenantId: string) => { db: ClinicDb; clock: Clock },
): (tenantId: string) => InboxGateway {
  const cache = new Map<string, InboxGateway>()
  return (tenantId: string) => {
    let gw = cache.get(tenantId)
    if (!gw) {
      const { db, clock } = getDb(tenantId)
      clinicInbox.listConversationsOp(db, workerCaller(tenantId), {}, clock)
      gw = createMemoryInboxGateway(db, clock)
      cache.set(tenantId, gw)
    }
    return gw
  }
}
