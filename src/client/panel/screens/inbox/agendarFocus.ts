/**
 * Pedido de «abrir o Agendar no contexto da conversa» ao sair do Contato
 * (ex.: tela focada no celular, DEC-162) e voltar à thread.
 */
let pending = false

export function requestAgendarOpen(): void {
  pending = true
}

export function consumeAgendarOpen(): boolean {
  const p = pending
  pending = false
  return p
}
