/** Pedido de «abrir no Resumo da IA» ao navegar da conversa para a ficha do contato. */
let pending = false

export function requestSummaryFocus(): void {
  pending = true
}

export function consumeSummaryFocus(): boolean {
  const p = pending
  pending = false
  return p
}
