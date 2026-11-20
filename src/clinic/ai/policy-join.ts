/**
 * DEC-210: junção pura da resposta «Remarcar e cancelar» (sem acesso a dados).
 * Usada pelo servidor (`policy-reply.ts`) e pela pré-visualização do painel.
 *
 * Revisão DEC-210 (Q3): esta função **não** omite B conflituoso — o painel
 * bloqueia novas gravações (U1); texto legado continua a sair até a owner editar.
 * Ver `policy-conflict.ts`.
 */

/** Frase que liga a regra do sinal (Recebimento) às regras gerais da clínica. */
export const POLICY_JOIN_PHRASE = 'Regras gerais da clínica:'
/** Limite da resposta combinada (cabe numa mensagem de WhatsApp sem cortar). */
export const POLICY_REPLY_MAX_CHARS = 1000
export const POLICY_OVERFLOW_PHRASE = 'Para as demais regras, fale com a equipe.'
/** Tamanho máximo das regras gerais (campo no painel e servidor). */
export const GENERAL_POLICY_MAX_CHARS = 500

/** `a` = texto do sinal (vazio se o sinal está desligado); `b` = regras gerais. */
export function joinPolicyParts(a: string, b: string): string {
  const sinal = a.trim()
  const gerais = b.trim()
  if (sinal && gerais && !sinal.includes(gerais) && !gerais.includes(sinal)) {
    const joined = `${sinal}\n\n${POLICY_JOIN_PHRASE}\n${gerais}`
    // Passa do limite: a regra do dinheiro sai inteira e o resto vai para a equipe.
    return joined.length > POLICY_REPLY_MAX_CHARS ? `${sinal}\n\n${POLICY_OVERFLOW_PHRASE}` : joined
  }
  // Um contém o outro (texto copiado): fica o mais completo, sem repetir.
  if (sinal && gerais) return sinal.length >= gerais.length ? sinal : gerais
  return sinal || gerais
}
