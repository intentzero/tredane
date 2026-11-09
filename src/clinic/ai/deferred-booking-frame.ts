/**
 * BookingFrame diferido — mesma TX que mensagem de saída + outbox (ADR-0015 / #412).
 *
 * Durante o turno a IA acumula o patch em memória (overlay para leituras).
 * O commit só ocorre em `afterPersist` dentro de `sendOutboundMessageOp`,
 * ou em `flushNow` quando não há envio.
 */
import type { Clock } from '../../db/clock'
import type { OutboxRow } from '../outbox'
import type { ClinicDb } from '../store'
import {
  clearBookingFrame,
  getBookingFrame,
  getScheduleSession,
  saveBookingFrame,
  type BookingFrame,
  type BookingFrameLastOffer,
  type BookingFramePatch,
  type BookingFramePending,
  type ScheduleSession,
  type ScheduleSessionPatch,
} from './schedule-session'
import { slotListRowCopy } from './slot-offer'

/** Placeholder substituído pelo id real da mensagem outbound no afterPersist. */
export const OUTBOUND_MESSAGE_ID_PLACEHOLDER = '__outbound__'

export type SendOutboundAfterPersistCtx = {
  db: ClinicDb
  tenantId: string
  conversationId: string
  messageId: string
  outboundId: string
  now: number
}

export type SendOutboundAfterPersist = (ctx: SendOutboundAfterPersistCtx) => OutboxRow[]

function sessionPatchToFramePatch(patch: ScheduleSessionPatch): BookingFramePatch {
  return {
    serviceId: patch.serviceId,
    line: patch.audienceLine,
    dayLabel: patch.dayLabel,
    period: patch.period,
    variantIds: patch.variantIds,
    time: patch.clockTime,
    date: patch.date,
    pending: patch.pending,
    lastOffer: patch.lastOffer,
    phase: patch.phase,
    proposal: patch.proposal,
    professionalPref: patch.professionalPref,
    catalogVersion: patch.catalogVersion,
    source: 'regra',
  }
}

function mergeFramePatch(
  base: BookingFramePatch | null,
  next: BookingFramePatch,
): BookingFramePatch {
  if (!base) return { ...next }
  const out: BookingFramePatch = { ...base }
  for (const key of Object.keys(next) as Array<keyof BookingFramePatch>) {
    if (next[key] !== undefined) {
      ;(out as Record<string, unknown>)[key] = next[key]
    }
  }
  return out
}

function bindOutboundIds(patch: BookingFramePatch, messageId: string): BookingFramePatch {
  const next = { ...patch }
  if (next.pending?.messageId === OUTBOUND_MESSAGE_ID_PLACEHOLDER) {
    next.pending = { ...next.pending, messageId }
  }
  if (next.lastOffer?.messageId === OUTBOUND_MESSAGE_ID_PLACEHOLDER) {
    next.lastOffer = { ...next.lastOffer, messageId }
  }
  if (next.sourceMessageId === OUTBOUND_MESSAGE_ID_PLACEHOLDER) {
    next.sourceMessageId = messageId
  }
  return next
}

export class DeferredBookingFrame {
  private cleared = false
  private patch: BookingFramePatch | null = null

  get hasWork(): boolean {
    return this.cleared || this.patch != null
  }

  /** Slot da pergunta pendente acumulada neste turno (`horario`, `linha`, …), ou null. */
  get pendingSlot(): string | null {
    return this.patch?.pending?.slot ?? null
  }

  /** Acumula mutação via patch de sessão (não grava SQLite). */
  save(patch: ScheduleSessionPatch): void {
    this.cleared = false
    this.patch = mergeFramePatch(this.patch, sessionPatchToFramePatch(patch))
  }

  /** Acumula mutação via patch de frame (não grava SQLite). */
  saveFrame(patch: BookingFramePatch): void {
    this.cleared = false
    this.patch = mergeFramePatch(this.patch, patch)
  }

  clearSession(): void {
    this.cleared = true
    this.patch = null
  }

  /** Overlay: DB + patch acumulado (para o resto do turno ler o estado futuro). */
  peekSession(db: ClinicDb, tenantId: string, conversationId: string): ScheduleSession | null {
    if (this.cleared) return null
    const base = getScheduleSession(db, tenantId, conversationId)
    if (!this.patch) return base
    const serviceId =
      this.patch.serviceId !== undefined ? this.patch.serviceId : (base?.serviceId ?? null)
    if (!serviceId) return null
    const serviceChanged = base != null && base.serviceId !== serviceId
    return {
      serviceId,
      audienceLine:
        this.patch.line !== undefined ? this.patch.line : (base?.audienceLine ?? null),
      dayLabel:
        this.patch.dayLabel !== undefined ? this.patch.dayLabel : (base?.dayLabel ?? null),
      // Alinha a saveBookingFrame: troca de serviço limpa período salvo patch explícito.
      period: serviceChanged
        ? this.patch.period !== undefined
          ? this.patch.period
          : null
        : this.patch.period !== undefined
          ? this.patch.period
          : (base?.period ?? null),
      variantIds:
        this.patch.variantIds !== undefined ? this.patch.variantIds : (base?.variantIds ?? null),
      clockTime: this.patch.time !== undefined ? this.patch.time : (base?.clockTime ?? null),
      updatedAt: base?.updatedAt ?? 0,
    }
  }

  peekFrame(db: ClinicDb, tenantId: string, conversationId: string): BookingFrame | null {
    if (this.cleared) return null
    const base = getBookingFrame(db, tenantId, conversationId)
    if (!this.patch) return base
    const serviceId =
      this.patch.serviceId !== undefined ? this.patch.serviceId : (base?.serviceId ?? null)
    if (!serviceId && !base) return null
    if (!serviceId) {
      const line = this.patch.line !== undefined ? this.patch.line : null
      const pending = this.patch.pending !== undefined ? this.patch.pending : null
      if (line || pending) {
        return {
          phase: this.patch.phase ?? (pending ? 'coletando' : 'idle'),
          serviceId: null,
          line,
          variantIds: null,
          professionalPref: null,
          date: null,
          period: null,
          time: null,
          pending,
          lastOffer: null,
          proposal: null,
          rescheduleAppointmentId: null,
          catalogVersion: this.patch.catalogVersion ?? base?.catalogVersion ?? '',
          provenance: {},
          updatedAt: base?.updatedAt ?? 0,
        }
      }
      return {
        phase: 'idle',
        serviceId: null,
        line: null,
        variantIds: null,
        professionalPref: null,
        date: null,
        period: null,
        time: null,
        pending: null,
        lastOffer: null,
        proposal: null,
        rescheduleAppointmentId: null,
        catalogVersion: '',
        provenance: {},
        updatedAt: base?.updatedAt ?? 0,
      }
    }
    // Overlay alinha a saveBookingFrame: troca de serviço limpa data/período
    // (e o resto do funil antigo) salvo patch explícito no mesmo turno («hoje»).
    const serviceChanged = base != null && base.serviceId !== serviceId
    const pending =
      this.patch.pending !== undefined ? this.patch.pending : (base?.pending ?? null)
    const lastOffer =
      this.patch.lastOffer !== undefined ? this.patch.lastOffer : (base?.lastOffer ?? null)
    const proposal =
      this.patch.proposal !== undefined ? this.patch.proposal : (base?.proposal ?? null)
    // Alinha a saveBookingFrame: serviceChanged deixa remarcando / apt-alvo.
    const phase =
      this.patch.phase ??
      (serviceChanged
        ? pending || lastOffer
          ? 'ofertado'
          : proposal
            ? 'proposto'
            : 'coletando'
        : (base?.phase ?? 'coletando'))
    return {
      phase,
      serviceId,
      line: this.patch.line !== undefined ? this.patch.line : (base?.line ?? null),
      variantIds:
        this.patch.variantIds !== undefined ? this.patch.variantIds : (base?.variantIds ?? null),
      professionalPref:
        this.patch.professionalPref !== undefined
          ? this.patch.professionalPref
          : (base?.professionalPref ?? null),
      date: serviceChanged
        ? this.patch.date !== undefined
          ? this.patch.date
          : null
        : this.patch.date !== undefined
          ? this.patch.date
          : (base?.date ?? null),
      period: serviceChanged
        ? this.patch.period !== undefined
          ? this.patch.period
          : null
        : this.patch.period !== undefined
          ? this.patch.period
          : (base?.period ?? null),
      time: this.patch.time !== undefined ? this.patch.time : (base?.time ?? null),
      pending,
      lastOffer,
      proposal,
      rescheduleAppointmentId: serviceChanged
        ? this.patch.rescheduleAppointmentId !== undefined
          ? this.patch.rescheduleAppointmentId
          : null
        : this.patch.rescheduleAppointmentId !== undefined
          ? this.patch.rescheduleAppointmentId
          : (base?.rescheduleAppointmentId ?? null),
      catalogVersion:
        this.patch.catalogVersion !== undefined
          ? this.patch.catalogVersion
          : (base?.catalogVersion ?? ''),
      provenance: this.patch.provenance ?? base?.provenance ?? {},
      updatedAt: base?.updatedAt ?? 0,
    }
  }

  /**
   * Callback para `SendOutboundInput.afterPersist`.
   * Grava clear/patch na mesma TX; substitui placeholder pelo messageId real.
   */
  toAfterPersist(clock: Clock): SendOutboundAfterPersist {
    const snapshot = {
      cleared: this.cleared,
      patch: this.patch ? { ...this.patch } : null,
    }
    return (ctx) => {
      const outboxes: OutboxRow[] = []
      if (snapshot.cleared) {
        const ob = clearBookingFrame(ctx.db, ctx.tenantId, ctx.conversationId, clock)
        if (ob) outboxes.push(ob)
        return outboxes
      }
      if (!snapshot.patch) return outboxes
      const bound = bindOutboundIds(snapshot.patch, ctx.messageId)
      const { outbox } = saveBookingFrame(
        ctx.db,
        ctx.tenantId,
        ctx.conversationId,
        bound,
        clock,
      )
      if (outbox) outboxes.push(outbox)
      return outboxes
    }
  }

  /** Sem outbound neste turno — persiste já (não há mensagem com que partilhar a TX). */
  flushNow(
    db: ClinicDb,
    tenantId: string,
    conversationId: string,
    clock: Clock,
  ): OutboxRow[] {
    return this.toAfterPersist(clock)({
      db,
      tenantId,
      conversationId,
      messageId: OUTBOUND_MESSAGE_ID_PLACEHOLDER,
      outboundId: '',
      now: clock.nowMs(),
    })
  }

  /** Consome o trabalho (após passar afterPersist ao send). */
  takeAfterPersist(clock: Clock): SendOutboundAfterPersist | undefined {
    if (!this.hasWork) return undefined
    const fn = this.toAfterPersist(clock)
    this.discard()
    return fn
  }

  /** Descarta o overlay sem gravar (após commit bem-sucedido noutro caminho). */
  discard(): void {
    this.cleared = false
    this.patch = null
  }
}

export function createDeferredBookingFrame(): DeferredBookingFrame {
  return new DeferredBookingFrame()
}

/** Patch de oferta com messageId = placeholder outbound (CF-22 / ADR-0015). */
export function offerFramePatch(input: {
  serviceId: string
  slots: Array<{ startsAt: number; professionalId: string; time: string; date: string }>
  phase: 'ofertado' | 'remarcando'
  date?: string
}): ScheduleSessionPatch {
  const options = input.slots.map((s) => ({
    // Chave civil no id; rótulo = forma única à cliente (DEC-138 / #507).
    key: `${s.date}T${s.time}`,
    label: slotListRowCopy(s.date, s.time).title,
  }))
  const pending: BookingFramePending = {
    slot: 'horario',
    options,
    messageId: OUTBOUND_MESSAGE_ID_PLACEHOLDER,
  }
  const lastOffer: BookingFrameLastOffer = {
    slots: input.slots.map((s) => ({
      startsAt: s.startsAt,
      professionalId: s.professionalId,
    })),
    messageId: OUTBOUND_MESSAGE_ID_PLACEHOLDER,
  }
  return {
    serviceId: input.serviceId,
    ...(input.date !== undefined ? { date: input.date } : {}),
    clockTime: null,
    phase: input.phase,
    pending,
    lastOffer,
  }
}
