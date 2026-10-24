/** IDs sintéticos estáveis para testes e harness (não usar crypto fraco em produção). */
export function newId(prefix: string): string {
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  return `${prefix}_${rand}`
}
