/**
 * Subconjunto MCP Streamable HTTP (JSON-RPC) para o servidor de revisão.
 * Stateless POST only — sem sessão SSE neste corte (DEC-158).
 */

export const MCP_PROTOCOL_VERSION = '2025-03-26'
export const MCP_SERVER_NAME = 'tredane-review-conversations'
export const MCP_SERVER_VERSION = '1.0.0'

export type JsonRpcId = string | number | null

export type JsonRpcRequest = {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method: string
  params?: unknown
}

export type JsonRpcSuccess = {
  jsonrpc: '2.0'
  id: JsonRpcId
  result: unknown
}

export type JsonRpcError = {
  jsonrpc: '2.0'
  id: JsonRpcId
  error: { code: number; message: string; data?: unknown }
}

export const JSON_RPC_PARSE_ERROR = -32700
export const JSON_RPC_INVALID_REQUEST = -32600
export const JSON_RPC_METHOD_NOT_FOUND = -32601
export const JSON_RPC_INVALID_PARAMS = -32602
export const JSON_RPC_INTERNAL_ERROR = -32603
/** Erros de aplicação (auth, tenant, not found) — fora do intervalo reservado. */
export const JSON_RPC_APPLICATION_ERROR = -32000

export function jsonRpcSuccess(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result }
}

export function jsonRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcError {
  return {
    jsonrpc: '2.0',
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  }
}

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return v.jsonrpc === '2.0' && typeof v.method === 'string'
}

export function toolTextResult(payload: unknown): {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: unknown
  isError?: boolean
} {
  const text =
    typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
  return {
    content: [{ type: 'text', text }],
    structuredContent: typeof payload === 'string' ? undefined : payload,
  }
}

export function toolErrorResult(message: string, data?: unknown): {
  content: Array<{ type: 'text'; text: string }>
  isError: true
  structuredContent?: unknown
} {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
    structuredContent: data,
  }
}
