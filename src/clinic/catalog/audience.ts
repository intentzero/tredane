/**
 * Audiência do serviço (DEC-075 / S2).
 * Descreve o serviço, não a pessoa. Não inferir pelo nome.
 */

export const SERVICE_AUDIENCES = ['feminino', 'masculino', 'qualquer'] as const
export type ServiceAudience = (typeof SERVICE_AUDIENCES)[number]

export const AUDIENCE_LABELS: Record<ServiceAudience, string> = {
  feminino: 'Feminino',
  masculino: 'Masculino',
  qualquer: 'Qualquer',
}

export function isServiceAudience(value: unknown): value is ServiceAudience {
  return value === 'feminino' || value === 'masculino' || value === 'qualquer'
}

/** Valor desconhecido ou omitido → qualquer. Nunca lê o nome do serviço. */
export function normalizeServiceAudience(value: unknown): ServiceAudience {
  return isServiceAudience(value) ? value : 'qualquer'
}

/**
 * Pedido explícito de linha no texto da cliente.
 * Ambos, nenhum, ou ambíguo → null (não filtra, não grava preferência).
 */
export function explicitAudienceLine(text: string): 'feminino' | 'masculino' | null {
  const folded = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const fem = /\bfeminin[oa]s?\b/.test(folded)
  const masc = /\bmasculin[oa]s?\b/.test(folded)
  if (fem && !masc) return 'feminino'
  if (masc && !fem) return 'masculino'
  return null
}

export function serviceMatchesAudience(
  audiencia: ServiceAudience | unknown,
  line: 'feminino' | 'masculino' | null,
): boolean {
  if (line == null) return true
  const a = normalizeServiceAudience(audiencia)
  return a === line || a === 'qualquer'
}

export function filterServicesForLine<T extends { audiencia: ServiceAudience }>(
  services: readonly T[],
  line: 'feminino' | 'masculino' | null,
): T[] {
  if (line == null) return [...services]
  return services.filter((s) => serviceMatchesAudience(s.audiencia, line))
}

/** Corpos inbound desde a última mensagem outbound (turno actual da cliente). */
export function currentClientTurnText(
  messages: ReadonlyArray<{ direction: string; body: string }>,
): string {
  const bodies: string[] = []
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!
    if (m.direction === 'outbound' || m.direction === 'system') break
    if (m.direction === 'inbound') bodies.push(m.body)
  }
  return bodies.reverse().join('\n')
}
