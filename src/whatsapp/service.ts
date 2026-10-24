/**
 * Orquestração Embedded Signup + gestão de conexão (#31).
 * D1 = índice/credenciais; Clinic DO = espelho readiness/UI.
 */
import type { Clock } from '../db/clock'
import type { AdminDb } from '../db/admin/store'
import { systemClock } from '../db/clock'
import {
  activateBinding,
  createSignupSession,
  getActiveBindingForTenant,
  getPendingSignupSession,
  consumeSignupSession,
  listBindingHistory,
  markBindingInterrupted,
  releaseBinding,
} from './bindings'
import { sealAccessToken } from './crypto'
import {
  createMetaAdapter,
  graphApiVersion,
  MetaExchangeError,
  resolveMetaMode,
  type MetaAdapter,
  type MetaEnv,
} from './meta'
import type {
  CompleteSignupInput,
  MetaMode,
  WhatsappConnectionView,
  WhatsappSignupPurpose,
  WhatsappSignupSessionView,
} from './types'

export type ClinicChannelSync = {
  syncChannel(
    tenantId: string,
    input: {
      status: 'disconnected' | 'connected' | 'interrupted'
      bindingId?: string | null
      phoneNumberId?: string | null
      wabaId?: string | null
      displayPhone?: string | null
      displayName?: string | null
      connectedBy?: string | null
      connectedAt?: number | null
      interruptedAt?: number | null
      interruptReason?: string | null
      actor?: string | null
      action: string
    },
  ): Promise<void>
}

export type WhatsappServiceDeps = {
  db: AdminDb
  clock?: Clock
  meta?: MetaAdapter
  metaEnv?: MetaEnv
  channelSync?: ClinicChannelSync
  tokenSecret?: string
}

export class WhatsappServiceError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, message: string, status = 400) {
    super(message)
    this.name = 'WhatsappServiceError'
    this.code = code
    this.status = status
  }
}

function toView(
  binding: ReturnType<typeof getActiveBindingForTenant>,
  history: ReturnType<typeof listBindingHistory>,
  metaMode: MetaMode,
): WhatsappConnectionView {
  if (!binding) {
    return {
      status: 'disconnected',
      phoneNumberId: null,
      wabaId: null,
      displayPhone: null,
      displayName: null,
      connectedAt: null,
      connectedByClerkUserId: null,
      interruptedAt: null,
      interruptReason: null,
      lastInboundAt: null,
      messageTemplates: [],
      history,
      metaMode,
    }
  }
  return {
    status: binding.status === 'interrupted' ? 'interrupted' : 'connected',
    phoneNumberId: binding.phoneNumberId,
    wabaId: binding.wabaId,
    displayPhone: binding.displayPhone,
    displayName: binding.displayName,
    connectedAt: binding.connectedAt,
    connectedByClerkUserId: binding.connectedByClerkUserId,
    interruptedAt: binding.interruptedAt,
    interruptReason: binding.interruptReason,
    lastInboundAt: null,
    messageTemplates: [],
    history,
    metaMode,
  }
}

export function createWhatsappService(deps: WhatsappServiceDeps) {
  const clock = deps.clock ?? systemClock
  const metaEnv = deps.metaEnv ?? {}
  const meta = deps.meta ?? createMetaAdapter(metaEnv)
  const metaMode = meta.mode
  const tokenSecret =
    deps.tokenSecret ?? metaEnv.META_APP_SECRET ?? metaEnv.META_MODE

  async function syncMirror(
    tenantId: string,
    view: WhatsappConnectionView,
    bindingId: string | null,
    actor: string | null,
    action: string,
  ): Promise<void> {
    if (!deps.channelSync) return
    await deps.channelSync.syncChannel(tenantId, {
      status: view.status,
      bindingId,
      phoneNumberId: view.phoneNumberId,
      wabaId: view.wabaId,
      displayPhone: view.displayPhone,
      displayName: view.displayName,
      connectedBy: view.connectedByClerkUserId,
      connectedAt: view.connectedAt,
      interruptedAt: view.interruptedAt,
      interruptReason: view.interruptReason,
      actor,
      action,
    })
  }

  return {
    getConnection(tenantId: string): WhatsappConnectionView {
      const binding = getActiveBindingForTenant(deps.db, tenantId)
      const history = listBindingHistory(deps.db, tenantId)
      return toView(binding, history, metaMode)
    },

    startSignupSession(input: {
      tenantId: string
      actorClerkUserId: string
      purpose: WhatsappSignupPurpose
    }): WhatsappSignupSessionView {
      const binding = getActiveBindingForTenant(deps.db, input.tenantId)
      if (input.purpose === 'connect' && binding) {
        throw new WhatsappServiceError(
          'already_connected',
          'A clínica já tem WhatsApp conectado',
          409,
        )
      }
      if (
        (input.purpose === 'reconnect' || input.purpose === 'replace')
        && !binding
      ) {
        throw new WhatsappServiceError(
          'not_connected',
          'Não há conexão WhatsApp para reconectar ou trocar',
          409,
        )
      }
      if (input.purpose === 'reconnect' && binding?.status !== 'interrupted') {
        throw new WhatsappServiceError(
          'not_interrupted',
          'Reconectar só se aplica a conexão interrompida',
          409,
        )
      }
      if (input.purpose === 'replace' && binding?.status === 'interrupted') {
        // Trocar a partir de interrompido é permitido (vai à Meta).
      }

      const session = createSignupSession(deps.db, clock, {
        tenantId: input.tenantId,
        purpose: input.purpose,
        actorClerkUserId: input.actorClerkUserId,
      })

      const live = metaMode === 'live'
      return {
        sessionId: session.id,
        state: session.state,
        purpose: session.purpose,
        expiresAt: session.expiresAt,
        metaMode,
        metaAppId: live ? (metaEnv.META_APP_ID ?? null) : null,
        metaConfigId: live ? (metaEnv.META_CONFIG_ID ?? null) : null,
        graphApiVersion: graphApiVersion(metaEnv),
      }
    },

    async completeSignup(input: {
      tenantId: string
      actorClerkUserId: string
      payload: CompleteSignupInput
    }): Promise<WhatsappConnectionView> {
      const session = getPendingSignupSession(
        deps.db,
        clock,
        input.payload.state,
        input.tenantId,
      )
      if (!session) {
        throw new WhatsappServiceError(
          'invalid_state',
          'Sessão Embedded Signup inválida, expirada ou já usada',
          400,
        )
      }

      let exchanged
      try {
        exchanged = await meta.exchangeSignupCode({
          code: input.payload.code,
          phoneNumberId: input.payload.phoneNumberId,
          wabaId: input.payload.wabaId,
          displayPhone: input.payload.displayPhone,
          displayName: input.payload.displayName,
        })
      } catch (err) {
        if (err instanceof MetaExchangeError) {
          throw new WhatsappServiceError(err.code, err.message, 400)
        }
        throw err
      }

      // Consumir state antes de activar — cancelado/forjado não deixa canal a meio.
      if (!consumeSignupSession(deps.db, clock, session.id)) {
        throw new WhatsappServiceError(
          'invalid_state',
          'Sessão Embedded Signup já consumida',
          400,
        )
      }

      const cipher = await sealAccessToken(
        exchanged.accessToken,
        typeof tokenSecret === 'string' ? tokenSecret : undefined,
        metaMode,
      )
      const expiresAt =
        exchanged.expiresIn != null
          ? clock.nowMs() + exchanged.expiresIn * 1000
          : null

      const result = activateBinding(deps.db, clock, {
        tenantId: input.tenantId,
        actorClerkUserId: input.actorClerkUserId,
        phoneNumberId: exchanged.phoneNumberId,
        wabaId: exchanged.wabaId,
        displayPhone: exchanged.displayPhone,
        displayName: exchanged.displayName,
        accessTokenCipher: cipher,
        tokenType: exchanged.tokenType,
        expiresAt,
        purpose: session.purpose,
      })

      if (!result.ok) {
        throw new WhatsappServiceError(result.code, result.message, 409)
      }

      const view = toView(
        result.binding,
        listBindingHistory(deps.db, input.tenantId),
        metaMode,
      )
      await syncMirror(
        input.tenantId,
        view,
        result.binding.id,
        input.actorClerkUserId,
        session.purpose === 'replace' ? 'channel_replaced' : 'channel_connected',
      )
      return view
    },

    async disconnect(input: {
      tenantId: string
      actorClerkUserId: string
      clinicNameConfirmation: string
      expectedClinicName: string
    }): Promise<WhatsappConnectionView> {
      const expected = input.expectedClinicName.trim()
      const got = input.clinicNameConfirmation.trim()
      if (!expected || got !== expected) {
        throw new WhatsappServiceError(
          'confirmation_mismatch',
          'Digite o nome exacto da clínica para desconectar',
          400,
        )
      }
      const released = releaseBinding(deps.db, clock, {
        tenantId: input.tenantId,
        actorClerkUserId: input.actorClerkUserId,
      })
      if (!released) {
        throw new WhatsappServiceError(
          'not_connected',
          'Não há conexão WhatsApp activa',
          409,
        )
      }
      const view = toView(undefined, listBindingHistory(deps.db, input.tenantId), metaMode)
      await syncMirror(
        input.tenantId,
        view,
        null,
        input.actorClerkUserId,
        'channel_disconnected',
      )
      return view
    },

    async markInterrupted(input: {
      tenantId: string
      reason: string
      actorClerkUserId?: string | null
    }): Promise<WhatsappConnectionView> {
      if (metaMode !== 'synthetic') {
        throw new WhatsappServiceError(
          'synthetic_only',
          'Interrupção manual só em META_MODE=synthetic até webhooks (#32)',
          403,
        )
      }
      const binding = markBindingInterrupted(deps.db, clock, input)
      if (!binding) {
        throw new WhatsappServiceError(
          'not_active',
          'Não há conexão activa para interromper',
          409,
        )
      }
      const view = toView(
        binding,
        listBindingHistory(deps.db, input.tenantId),
        metaMode,
      )
      await syncMirror(
        input.tenantId,
        view,
        binding.id,
        input.actorClerkUserId ?? 'system:meta',
        'channel_interrupted',
      )
      return view
    },

    metaMode(): MetaMode {
      return metaMode
    },
  }
}

export type WhatsappService = ReturnType<typeof createWhatsappService>

export { resolveMetaMode }
