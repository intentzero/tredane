/**
 * Alterar detalhes → menu IA (Paulo «Quero»/«Sim», 09/11/2026).
 * Invalida a proposta sem handoff; pergunta Horário | Serviço [| Variantes].
 * Qualquer ramo fecha em nova proposta versionada (DEC-061: só Confirmar marca).
 * «Falar com a equipe» continua DEC-083 (outro botão).
 */
import type { Clock } from '../../db/clock'
import type { ClinicCaller } from '../envelopes'
import { getService, listServices } from '../config/services'
import { readZoneSnapshots } from '../config/zones'
import { sendOutboundMessageOp } from '../inbox/operations'
import type { OutboxRow } from '../outbox'
import {
  retireActiveProposal,
  type AppointmentProposalRow,
} from '../proposals'
import type { ClinicDb } from '../store'
import { tryAiAutoBook, type AutoBookOutcome } from './autobook'
import { cancelAutoDraft } from './autodraft'
import {
  deliverCatalogConsult,
  planCatalogConsult,
} from './catalog-consult'
import {
  encodeChoiceId,
  META_BUTTON_TITLE_MAX,
  pendingForChoiceOffer,
  toSendInteractive,
  type ChoiceInteractive,
  type ChoiceInteractiveButtons,
} from './choice-offer'
import {
  createDeferredBookingFrame,
  OUTBOUND_MESSAGE_ID_PLACEHOLDER,
} from './deferred-booking-frame'
import {
  getBookingFrame,
  saveBookingFrame,
  type BookingFramePending,
} from './schedule-session'
import { readCatalogVersion } from './turn-context'
import { needsAudienceLine } from './variant-line'

const AUTODRAFT_ACTOR_ID = 'system:ai-autodraft'

export const ALTER_DETAILS_MENU_BODY = 'O que você quer mudar?'
export const ALTER_HORARIO_KEY = 'horario'
export const ALTER_SERVICO_KEY = 'servico'
export const ALTER_VARIANTES_KEY = 'variantes'
export const ALTER_HORARIO_LABEL = 'Horário'
export const ALTER_SERVICO_LABEL = 'Serviço'
export const ALTER_VARIANTES_LABEL = 'Variantes'

export type AlterDetailsKey =
  | typeof ALTER_HORARIO_KEY
  | typeof ALTER_SERVICO_KEY
  | typeof ALTER_VARIANTES_KEY

function clip(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  return `${t.slice(0, Math.max(1, max - 1)).trimEnd()}…`
}

/** Serviço com zonas ativas ou audiência mista → mostra botão Variantes. */
export function serviceOffersVariantBranch(serviceId: string | null | undefined, db: ClinicDb, tenantId: string): boolean {
  if (!serviceId) return false
  const service = getService(db, tenantId, serviceId)
  if (!service || !service.active) return false
  const active = service.zones.filter((z) => z.active)
  return active.length > 0 || needsAudienceLine(active)
}

export function buildAlterDetailsMenu(input: {
  catalogVersion: string
  includeVariants: boolean
}): { interactive: ChoiceInteractiveButtons; pending: BookingFramePending; body: string } {
  const options: Array<{ key: AlterDetailsKey; label: string }> = [
    { key: ALTER_HORARIO_KEY, label: ALTER_HORARIO_LABEL },
    { key: ALTER_SERVICO_KEY, label: ALTER_SERVICO_LABEL },
  ]
  if (input.includeVariants) {
    options.push({ key: ALTER_VARIANTES_KEY, label: ALTER_VARIANTES_LABEL })
  }
  return {
    body: ALTER_DETAILS_MENU_BODY,
    interactive: {
      mode: 'buttons',
      buttons: options.map((o) => ({
        id: encodeChoiceId('alter', input.catalogVersion, o.key),
        title: clip(o.label, META_BUTTON_TITLE_MAX),
      })),
    },
    pending: pendingForChoiceOffer({ slot: 'alter', options }),
  }
}

/**
 * Garante service/variantes/audiência no quadro a partir do frame ou do snapshot
 * da proposta; limpa só a ponte proposta/oferta (o menu decide o resto).
 */
export function hydrateFrameForAlterMenu(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  proposal: AppointmentProposalRow,
  pending: BookingFramePending,
  clock: Clock,
): void {
  const frame = getBookingFrame(db, tenantId, conversationId)
  const snaps = readZoneSnapshots(db, tenantId, 'proposal', proposal.id)
  const fromProposal = snaps.map((s) => s.zoneId).filter((id): id is string => Boolean(id))
  const serviceId = frame?.serviceId ?? proposal.serviceId
  const variantIds =
    frame?.variantIds && frame.variantIds.length > 0
      ? frame.variantIds
      : fromProposal.length > 0
        ? fromProposal
        : null
  const catalogVersion =
    frame?.catalogVersion || readCatalogVersion(db, tenantId)
  saveBookingFrame(
    db,
    tenantId,
    conversationId,
    {
      serviceId,
      line: frame?.line ?? null,
      variantIds,
      professionalPref: frame?.professionalPref ?? proposal.professionalId ?? null,
      // Mantém date/period até o ramo Horário limpar (ou Serviço/Variantes).
      date: frame?.date ?? null,
      period: frame?.period ?? null,
      time: null,
      pending: { ...pending, messageId: OUTBOUND_MESSAGE_ID_PLACEHOLDER },
      lastOffer: null,
      proposal: null,
      catalogVersion,
      phase: 'coletando',
      source: 'botao',
    },
    clock,
  )
}

export type BeginAlterDetailsMenuResult = {
  outbox: OutboxRow[]
  includeVariants: boolean
}

/**
 * Após invalidar a proposta: envia o menu Horário|Serviço[|Variantes].
 * Não pausa a IA e não abre alter_awaiting_team.
 * `proposal` opcional: sem snapshot, usa só o BookingFrame (reoferta stale).
 */
export function beginAlterDetailsMenu(
  db: ClinicDb,
  caller: ClinicCaller,
  conversationId: string,
  clock: Clock,
  opts?: {
    providerEventKey?: string | null
    proposal?: AppointmentProposalRow | null
  },
): BeginAlterDetailsMenuResult {
  const proposal = opts?.proposal ?? null
  cancelAutoDraft(db, caller.tenantId, conversationId)
  const frame = getBookingFrame(db, caller.tenantId, conversationId)
  const serviceId = frame?.serviceId ?? proposal?.serviceId ?? null
  const catalogVersion =
    frame?.catalogVersion || readCatalogVersion(db, caller.tenantId)
  const includeVariants = serviceOffersVariantBranch(
    serviceId,
    db,
    caller.tenantId,
  )
  const menu = buildAlterDetailsMenu({ catalogVersion, includeVariants })
  if (proposal) {
    hydrateFrameForAlterMenu(
      db,
      caller.tenantId,
      conversationId,
      proposal,
      menu.pending,
      clock,
    )
  } else if (serviceId) {
    saveBookingFrame(
      db,
      caller.tenantId,
      conversationId,
      {
        serviceId,
        line: frame?.line ?? null,
        variantIds: frame?.variantIds ?? null,
        time: null,
        pending: { ...menu.pending, messageId: OUTBOUND_MESSAGE_ID_PLACEHOLDER },
        lastOffer: null,
        proposal: null,
        catalogVersion,
        phase: 'coletando',
        source: 'botao',
      },
      clock,
    )
  }
  // Regrava pending com messageId real via afterPersist.
  const deferred = createDeferredBookingFrame()
  if (serviceId) {
    deferred.save({
      serviceId,
      catalogVersion,
      pending: menu.pending,
      lastOffer: null,
      proposal: null,
      clockTime: null,
      phase: 'coletando',
    })
  } else {
    deferred.saveFrame({
      serviceId: null,
      catalogVersion,
      pending: menu.pending,
      lastOffer: null,
      proposal: null,
      time: null,
      phase: 'coletando',
      source: 'botao',
    })
  }
  const reqKey = proposal
    ? `proposal.alter.menu:${proposal.id}:v${proposal.version}:${opts?.providerEventKey ?? 'click'}`
    : `proposal.alter.menu:${conversationId}:${opts?.providerEventKey ?? clock.nowMs()}`
  try {
    const sent = sendOutboundMessageOp(
      db,
      caller,
      {
        conversationId,
        body: menu.body,
        interactive: toSendInteractive(menu.interactive),
        clientRequestId: reqKey,
        authorClerkUserId: AUTODRAFT_ACTOR_ID,
        authorDisplayName: 'IA',
        afterPersist: deferred.toAfterPersist(clock),
      },
      clock,
    )
    deferred.discard()
    return { outbox: sent.outbox, includeVariants }
  } catch (err) {
    deferred.discard()
    throw err
  }
}

async function sendAutoBookOutbound(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
  conversationId: string,
  autoBook: AutoBookOutcome,
  clientRequestId: string,
): Promise<OutboxRow[]> {
  if (autoBook.proposalId && !autoBook.replyText?.trim()) {
    autoBook.deferredFrame?.discard()
    return []
  }
  const replyBody = autoBook.replyText?.trim()
  if (!replyBody) {
    if (autoBook.deferredFrame?.hasWork) {
      return autoBook.deferredFrame.flushNow(db, caller.tenantId, conversationId, clock)
    }
    return []
  }
  try {
    const sent = sendOutboundMessageOp(
      db,
      caller,
      {
        conversationId,
        body: replyBody,
        interactive: toSendInteractive(autoBook.interactive as ChoiceInteractive | null),
        clientRequestId,
        authorClerkUserId: AUTODRAFT_ACTOR_ID,
        authorDisplayName: 'IA',
        ...(autoBook.deferredFrame?.hasWork
          ? { afterPersist: autoBook.deferredFrame.toAfterPersist(clock) }
          : {}),
      },
      clock,
    )
    autoBook.deferredFrame?.discard()
    return sent.outbox
  } catch {
    if (autoBook.deferredFrame?.hasWork) {
      return autoBook.deferredFrame.flushNow(db, caller.tenantId, conversationId, clock)
    }
    return []
  }
}

export type AlterDetailsChoiceResult = {
  handled: true
  branch: AlterDetailsKey
  autoBook?: AutoBookOutcome
  outbox: OutboxRow[]
}

/**
 * Toque no menu Alterar detalhes. Não marca (DEC-061).
 */
export async function handleAlterDetailsChoice(
  db: ClinicDb,
  caller: ClinicCaller,
  input: {
    tenantId: string
    conversationId: string
    key: AlterDetailsKey
    providerEventKey?: string | null
    capability?: boolean
  },
  clock: Clock,
): Promise<AlterDetailsChoiceResult> {
  cancelAutoDraft(db, input.tenantId, input.conversationId)
  // Proposta antiga já inválida no clique Alterar; reforça se ainda houver aberta.
  retireActiveProposal(db, input.tenantId, input.conversationId, clock)

  const frame = getBookingFrame(db, input.tenantId, input.conversationId)
  const services = listServices(db, input.tenantId).filter((s) => s.active)
  const svc = services.find((s) => s.id === frame?.serviceId)
  const lastInbound = db.get<{ id: string }>(
    `SELECT id FROM messages
     WHERE tenant_id = ? AND conversation_id = ? AND direction = 'inbound'
     ORDER BY created_at DESC LIMIT 1`,
    input.tenantId,
    input.conversationId,
  )
  const confirmationMessageId =
    lastInbound?.id ?? `alter:${input.providerEventKey ?? clock.nowMs()}`
  const clientRequestId = `proposal.alter.${input.key}:${input.providerEventKey ?? clock.nowMs()}`

  if (input.key === ALTER_SERVICO_KEY) {
    const action = planCatalogConsult({
      text: 'quero outro serviço',
      frame,
      services: listServices(db, input.tenantId),
      catalogVersion: frame?.catalogVersion || readCatalogVersion(db, input.tenantId),
      hasActiveProposal: false,
    })
    if (!action) {
      return { handled: true, branch: input.key, outbox: [] }
    }
    const delivered = deliverCatalogConsult(db, caller, clock, {
      conversationId: input.conversationId,
      clientRequestId,
      authorClerkUserId: AUTODRAFT_ACTOR_ID,
      authorDisplayName: 'IA',
      action,
    })
    return { handled: true, branch: input.key, outbox: delivered.outbox }
  }

  if (input.key === ALTER_VARIANTES_KEY) {
    if (!frame?.serviceId || !svc) {
      // Sem serviço no quadro → cai no catálogo.
      const action = planCatalogConsult({
        text: 'quero outro serviço',
        frame,
        services: listServices(db, input.tenantId),
        catalogVersion: readCatalogVersion(db, input.tenantId),
        hasActiveProposal: false,
      })
      if (!action) return { handled: true, branch: input.key, outbox: [] }
      const delivered = deliverCatalogConsult(db, caller, clock, {
        conversationId: input.conversationId,
        clientRequestId,
        authorClerkUserId: AUTODRAFT_ACTOR_ID,
        authorDisplayName: 'IA',
        action,
      })
      return { handled: true, branch: input.key, outbox: delivered.outbox }
    }
    saveBookingFrame(
      db,
      input.tenantId,
      input.conversationId,
      {
        serviceId: frame.serviceId,
        line: null,
        variantIds: null,
        date: null,
        period: null,
        time: null,
        pending: null,
        lastOffer: null,
        proposal: null,
        phase: 'coletando',
        source: 'botao',
      },
      clock,
    )
    const autoBook = await tryAiAutoBook(db, caller, clock, {
      conversationId: input.conversationId,
      capability: input.capability !== false,
      turnTextOverride: svc.name,
      confirmationMessageIdOverride: confirmationMessageId,
    })
    const outbox = await sendAutoBookOutbound(
      db,
      caller,
      clock,
      input.conversationId,
      autoBook,
      clientRequestId,
    )
    return { handled: true, branch: input.key, autoBook, outbox }
  }

  // Horário — mantém serviço/variantes/audiência; limpa data/hora/oferta; reoferta.
  if (!frame?.serviceId || !svc) {
    const action = planCatalogConsult({
      text: 'quero outro serviço',
      frame,
      services: listServices(db, input.tenantId),
      catalogVersion: readCatalogVersion(db, input.tenantId),
      hasActiveProposal: false,
    })
    if (!action) return { handled: true, branch: input.key, outbox: [] }
    const delivered = deliverCatalogConsult(db, caller, clock, {
      conversationId: input.conversationId,
      clientRequestId,
      authorClerkUserId: AUTODRAFT_ACTOR_ID,
      authorDisplayName: 'IA',
      action,
    })
    return { handled: true, branch: input.key, outbox: delivered.outbox }
  }

  saveBookingFrame(
    db,
    input.tenantId,
    input.conversationId,
    {
      serviceId: frame.serviceId,
      line: frame.line,
      variantIds: frame.variantIds,
      date: null,
      period: null,
      time: null,
      pending: null,
      lastOffer: null,
      proposal: null,
      phase: 'coletando',
      source: 'botao',
    },
    clock,
  )

  const autoBook = await tryAiAutoBook(db, caller, clock, {
    conversationId: input.conversationId,
    capability: input.capability !== false,
    // Continua o mesmo serviço (namedNow) sem eco de zonas — zoneEcho skip.
    turnTextOverride: svc.name,
    confirmationMessageIdOverride: confirmationMessageId,
    zoneEcho: 'skip',
  })
  const outbox = await sendAutoBookOutbound(
    db,
    caller,
    clock,
    input.conversationId,
    autoBook,
    clientRequestId,
  )
  return { handled: true, branch: input.key, autoBook, outbox }
}
