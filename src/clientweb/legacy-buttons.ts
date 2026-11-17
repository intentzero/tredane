/**
 * Botões do funil conversacional que ainda estão em mensagens antigas no WhatsApp (DEC-202).
 *
 * O funil foi removido: nenhum destes botões marca, remarca ou cancela. Quem trata o clique
 * responde com o link «Abrir agenda» (ou, na proposta, passa à equipe). Aqui só se reconhece o id.
 */

export type LegacyFunnelButton =
  /** Listas e botões de linha, variantes, horários, serviço e eco (M5). */
  | { kind: 'choice' }
  /** Cartão de proposta: Confirmar, Alterar ou Falar com a equipe. */
  | { kind: 'proposal'; action: 'confirm' | 'alter' | 'human' }
  /** «Cancelar marcação» do chat. */
  | { kind: 'cancel_confirm' }
  /** «Continuar» do FAQ. */
  | { kind: 'faq_continue' }

export function parseLegacyFunnelButton(raw: string): LegacyFunnelButton | null {
  const id = raw.trim()
  if (id.startsWith('ch1~')) return { kind: 'choice' }
  const prop = /^prop:[^:]+:v\d+:(confirm|alter|human)$/.exec(id)
  if (prop) return { kind: 'proposal', action: prop[1] as 'confirm' | 'alter' | 'human' }
  if (/^apt:cancel:[^:]+:confirm$/.test(id)) return { kind: 'cancel_confirm' }
  if (id === 'fu:faq:continue') return { kind: 'faq_continue' }
  return null
}
