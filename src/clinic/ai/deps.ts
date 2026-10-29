import {
  buildAiAdapter,
  isSyntheticFallback,
  resolveAiMode,
  type AiGatewayConfig,
  type SimulatedAiOptions,
} from '../../ai'
import { abuseLimitsFromEnv, type AbuseLimits } from './abuse-limits'
import type { AiAssistDeps } from './types'

/** Config serializável Worker → DO (RPC não transporta classes). */
export type AiAssistRpcDeps = {
  mode: 'synthetic' | 'gateway'
  gateway?: {
    accountId: string
    gatewayId: string
    gatewayToken: string
    anthropicApiKey?: string
    replyModel?: string
    summaryModel?: string
  }
  simulated?: SimulatedAiOptions
  /** Nome da clínica (D1 tenants.name), preenchido pelo DO. */
  clinicName?: string | null
  /**
   * Owner pausou novas propostas e cliques de confirmação nesta clínica.
   * A capacidade em si está sempre ligada (Paulo, 29/10/2026): não há var de ambiente.
   */
  autoBookPaused?: boolean
  /**
   * S7 (#178): limites efetivos. Em produção o DO resolve com settings da clínica;
   * env `ABUSE_LIMIT_*` = tetos/bootstrap. `ABUSE_LIMITS=on` só marca platform.enabled legado.
   */
  abuseLimits?: AbuseLimits
}

/** Capacidade de proposta e clique. Sempre ligada; a pausa da owner é o desligamento. */
export function autoBookCapability(): boolean {
  return true
}

export function toAiAssistDeps(rpc: AiAssistRpcDeps): AiAssistDeps {
  const gateway: AiGatewayConfig | undefined = rpc.gateway
    ? {
        accountId: rpc.gateway.accountId,
        gatewayId: rpc.gateway.gatewayId,
        gatewayToken: rpc.gateway.gatewayToken,
        anthropicApiKey: rpc.gateway.anthropicApiKey,
        replyModel: rpc.gateway.replyModel,
        summaryModel: rpc.gateway.summaryModel,
      }
    : undefined
  const build = { mode: rpc.mode, gateway, simulated: rpc.simulated }
  return {
    mode: rpc.mode,
    adapter: buildAiAdapter(build),
    syntheticFallback: isSyntheticFallback(build),
    clinicName: rpc.clinicName ?? null,
    autoBookPaused: rpc.autoBookPaused === true,
    ...(rpc.abuseLimits ? { abuseLimits: rpc.abuseLimits } : {}),
  }
}

export function rpcDepsFromEnv(env: {
  AI_MODE?: string
  CF_ACCOUNT_ID?: string
  AI_GATEWAY_ID?: string
  AI_GATEWAY_TOKEN?: string
  ANTHROPIC_API_KEY?: string
  ABUSE_LIMITS?: string
  [key: `ABUSE_LIMIT_${string}`]: string | undefined
}): AiAssistRpcDeps {
  const mode = resolveAiMode(env.AI_MODE)
  return {
    mode,
    abuseLimits: abuseLimitsFromEnv(env as Record<string, string | undefined>),
    gateway: {
      accountId: env.CF_ACCOUNT_ID ?? '',
      gatewayId: env.AI_GATEWAY_ID ?? 'default',
      gatewayToken: env.AI_GATEWAY_TOKEN ?? '',
      anthropicApiKey: env.ANTHROPIC_API_KEY,
    },
  }
}
