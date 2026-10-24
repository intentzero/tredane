import type { Clock } from '../../db/clock'
import { upsertContact } from '../contacts'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import { assertClinicSchemaReady } from '../migrations'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import {
  createConversation,
  listConversations,
  setConversationAssignee,
  setConversationStatus,
  touchConversationMessage,
} from './conversations'
import { insertMessage } from './messages'

/**
 * Dados sintéticos fictícios (nunca dados reais).
 * Idempotente: se já houver conversas, não faz nada.
 */
export function seedSyntheticInboxOp(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
  opts: { force?: boolean } = {},
): { seeded: boolean; conversationCount: number } {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)

  const existing = listConversations(db, meta.tenantId, { limit: 1 })
  if (existing.items.length > 0 && !opts.force) {
    return { seeded: false, conversationCount: existing.items.length }
  }

  return db.transactionSync(() => {
    const t0 = clock.nowMs()

    const marina = upsertContact(
      db,
      {
        tenantId: meta.tenantId,
        waId: '5511987001001',
        displayName: 'Marina Alves',
        id: 'ctc_seed_marina',
      },
      clock,
    )
    const juliana = upsertContact(
      db,
      {
        tenantId: meta.tenantId,
        waId: '5511987001002',
        displayName: 'Juliana Prado',
        id: 'ctc_seed_juliana',
      },
      clock,
    )
    const carla = upsertContact(
      db,
      {
        tenantId: meta.tenantId,
        waId: '5511987001003',
        displayName: 'Carla Mendes',
        id: 'ctc_seed_carla',
      },
      clock,
    )
    const renata = upsertContact(
      db,
      {
        tenantId: meta.tenantId,
        waId: '5511987001004',
        displayName: 'Renata Lima',
        id: 'ctc_seed_renata',
      },
      clock,
    )

    // Nova — sem responsável
    const cnvMarina = createConversation(
      db,
      {
        tenantId: meta.tenantId,
        contactId: marina.id,
        status: 'new',
        id: 'cnv_seed_marina',
      },
      clock,
    )
    const msgM = insertMessage(
      db,
      {
        tenantId: meta.tenantId,
        conversationId: cnvMarina.id,
        direction: 'inbound',
        body: 'Oi! Quanto custa a limpeza de pele?',
        externalMessageId: 'seed:marina:1',
        deliveryState: 'received',
        createdAt: t0 - 60_000,
        id: 'msg_seed_marina_1',
      },
      clock,
    )
    touchConversationMessage(db, {
      tenantId: meta.tenantId,
      conversationId: cnvMarina.id,
      preview: msgM.body,
      direction: 'inbound',
      at: msgM.createdAt,
      bumpUnread: true,
      reopenIfClosed: false,
    })

    // Em atendimento — atribuída ao viewer (se houver) ou placeholder
    const assigneeId = caller.actorId ?? 'user_synth_attendant_a'
    const cnvJuliana = createConversation(
      db,
      {
        tenantId: meta.tenantId,
        contactId: juliana.id,
        status: 'open',
        id: 'cnv_seed_juliana',
      },
      clock,
    )
    setConversationAssignee(db, {
      tenantId: meta.tenantId,
      conversationId: cnvJuliana.id,
      assigneeClerkUserId: assigneeId,
      assigneeDisplayName: 'Você',
      updatedAt: t0 - 120_000,
    })
    insertMessage(
      db,
      {
        tenantId: meta.tenantId,
        conversationId: cnvJuliana.id,
        direction: 'inbound',
        body: 'Queria remarcar para a tarde.',
        externalMessageId: 'seed:juliana:1',
        deliveryState: 'received',
        createdAt: t0 - 180_000,
        id: 'msg_seed_juliana_1',
      },
      clock,
    )
    const msgJ2 = insertMessage(
      db,
      {
        tenantId: meta.tenantId,
        conversationId: cnvJuliana.id,
        direction: 'outbound',
        body: 'Vou verificar a agenda e já te retorno.',
        externalMessageId: 'seed:juliana:2',
        deliveryState: 'accepted',
        authorClerkUserId: assigneeId,
        authorDisplayName: 'Você',
        createdAt: t0 - 120_000,
        id: 'msg_seed_juliana_2',
      },
      clock,
    )
    insertMessage(
      db,
      {
        tenantId: meta.tenantId,
        conversationId: cnvJuliana.id,
        direction: 'system',
        body: 'Você assumiu a conversa',
        deliveryState: 'received',
        authorClerkUserId: assigneeId,
        authorDisplayName: 'Você',
        createdAt: t0 - 170_000,
        id: 'msg_seed_juliana_sys',
      },
      clock,
    )
    touchConversationMessage(db, {
      tenantId: meta.tenantId,
      conversationId: cnvJuliana.id,
      preview: msgJ2.body,
      direction: 'outbound',
      at: msgJ2.createdAt,
      bumpUnread: false,
      reopenIfClosed: false,
    })

    // Atribuída a outro membro (visível a todos — DEC-015)
    const cnvCarla = createConversation(
      db,
      {
        tenantId: meta.tenantId,
        contactId: carla.id,
        status: 'open',
        id: 'cnv_seed_carla',
      },
      clock,
    )
    setConversationAssignee(db, {
      tenantId: meta.tenantId,
      conversationId: cnvCarla.id,
      assigneeClerkUserId: 'user_synth_bruno',
      assigneeDisplayName: 'Bruno',
      updatedAt: t0 - 86_400_000,
    })
    const msgC = insertMessage(
      db,
      {
        tenantId: meta.tenantId,
        conversationId: cnvCarla.id,
        direction: 'inbound',
        body: 'Combinado, até sexta!',
        externalMessageId: 'seed:carla:1',
        deliveryState: 'received',
        createdAt: t0 - 86_400_000,
        id: 'msg_seed_carla_1',
      },
      clock,
    )
    touchConversationMessage(db, {
      tenantId: meta.tenantId,
      conversationId: cnvCarla.id,
      preview: msgC.body,
      direction: 'inbound',
      at: msgC.createdAt,
      bumpUnread: false,
      reopenIfClosed: false,
    })

    // Encerrada
    const cnvRenata = createConversation(
      db,
      {
        tenantId: meta.tenantId,
        contactId: renata.id,
        status: 'closed',
        id: 'cnv_seed_renata',
      },
      clock,
    )
    setConversationAssignee(db, {
      tenantId: meta.tenantId,
      conversationId: cnvRenata.id,
      assigneeClerkUserId: 'user_synth_ana',
      assigneeDisplayName: 'Ana',
      updatedAt: t0 - 3 * 86_400_000,
    })
    setConversationStatus(db, {
      tenantId: meta.tenantId,
      conversationId: cnvRenata.id,
      status: 'closed',
      updatedAt: t0 - 3 * 86_400_000,
    })
    const msgR = insertMessage(
      db,
      {
        tenantId: meta.tenantId,
        conversationId: cnvRenata.id,
        direction: 'inbound',
        body: 'Obrigada pelo atendimento.',
        externalMessageId: 'seed:renata:1',
        deliveryState: 'received',
        createdAt: t0 - 3 * 86_400_000,
        id: 'msg_seed_renata_1',
      },
      clock,
    )
    touchConversationMessage(db, {
      tenantId: meta.tenantId,
      conversationId: cnvRenata.id,
      preview: msgR.body,
      direction: 'inbound',
      at: msgR.createdAt,
      bumpUnread: false,
      reopenIfClosed: false,
    })

    const counted = listConversations(db, meta.tenantId, { limit: 20 })
    return { seeded: true, conversationCount: counted.items.length }
  })
}
