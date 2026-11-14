/**
 * A IA como responsável de uma conversa (DEC-093). Sem imports: o painel também usa este
 * módulo, para reconhecer o responsável «IA» pelo id e não por um texto (DEC-184).
 */
export const AI_ACTOR_ID = 'system:ai-autodraft'
export const AI_ACTOR_NAME = 'IA'

export function isAiActorId(id: string | null | undefined): boolean {
  return id === AI_ACTOR_ID
}
