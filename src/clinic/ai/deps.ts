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
  /**
   * Capacidade de agendamento automático (S2, #173). Desligada por padrão: só `true` explícito
   * com `AI_AUTOBOOK=on`. Independente do opt-in de sugestões da clínica.
   */
  autoBook?: boolean
  /** Clínicas autorizadas (AI_AUTOBOOK_TENANTS, separadas por vírgula). Vazio = nenhuma. */
  autoBookTenants?: string[]
}

/** Só o valor exato «on» liga; ausente, vazio, inválido ou erro → desligado. */
export function parseAutoBookFlag(v: unknown): boolean {
  return typeof v === 'string' && v.trim().toLowerCase() === 'on'
}

export function parseAutoBookTenants(v: unknown): string[] {
  if (typeof v !== 'string') return []
  return v.split(',').map((t) => t.trim()).filter(Boolean)
}

/** Capacidade efetiva para um tenant; revalidar no momento do efeito. */
export function autoBookCapability(rpc: Pick<AiAssistRpcDeps, 'autoBook' | 'autoBookTenants'>, tenantId: string): boolean {
  return rpc.autoBook === true && (rpc.autoBookTenants ?? []).includes(tenantId)
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
    autoBook: rpc.autoBook === true,
    autoBookTenants: rpc.autoBookTenants ?? [],
  }
}

export function rpcDepsFromEnv(env: {
  AI_MODE?: string
  CF_ACCOUNT_ID?: string
  AI_GATEWAY_ID?: string
  AI_GATEWAY_TOKEN?: string
  ANTHROPIC_API_KEY?: string
  AI_AUTOBOOK?: string
  AI_AUTOBOOK_TENANTS?: string
}): AiAssistRpcDeps {
  const mode = resolveAiMode(env.AI_MODE)
  return {
    mode,
    autoBook: parseAutoBookFlag(env.AI_AUTOBOOK),
    autoBookTenants: parseAutoBookTenants(env.AI_AUTOBOOK_TENANTS),
    gateway: {
      accountId: env.CF_ACCOUNT_ID ?? '',
      gatewayId: env.AI_GATEWAY_ID ?? 'default',
      gatewayToken: env.AI_GATEWAY_TOKEN ?? '',
      anthropicApiKey: env.ANTHROPIC_API_KEY,
    },
  }
}
