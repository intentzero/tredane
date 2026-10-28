import {
  buildAiAdapter,
  isSyntheticFallback,
  resolveAiMode,
  type AiGatewayConfig,
  type SimulatedAiOptions,
} from '../../ai'
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
  /** false = sem agendamento pela IA (kill switch AI_AUTOBOOK=off). */
  autoBook?: boolean
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
    autoBook: rpc.autoBook !== false,
  }
}

export function rpcDepsFromEnv(env: {
  AI_MODE?: string
  CF_ACCOUNT_ID?: string
  AI_GATEWAY_ID?: string
  AI_GATEWAY_TOKEN?: string
  ANTHROPIC_API_KEY?: string
  AI_AUTOBOOK?: string
}): AiAssistRpcDeps {
  const mode = resolveAiMode(env.AI_MODE)
  return {
    mode,
    autoBook: (env.AI_AUTOBOOK ?? '').trim().toLowerCase() !== 'off',
    gateway: {
      accountId: env.CF_ACCOUNT_ID ?? '',
      gatewayId: env.AI_GATEWAY_ID ?? 'default',
      gatewayToken: env.AI_GATEWAY_TOKEN ?? '',
      anthropicApiKey: env.ANTHROPIC_API_KEY,
    },
  }
}
