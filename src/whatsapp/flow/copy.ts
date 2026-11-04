/**
 * Copy do Flow de agendamento (ADR-0016 §10).
 * C1–C15: **Confirmado** (Paulo, 04/11/2026 America/Sao_Paulo, opção A, DEC-104).
 * Revisão no mesmo dia, após o open em staging (~14:34): C4b, C8 e C16.
 * Rótulos Confirmados reutilizados no Flow: Feminina / Masculina (DEC-134).
 * «Todas» do M5 não entra no CheckboxGroup (Paulo, 04/11/2026, «Podemos retirar o Todas»).
 */
export const FLOW_COPY = {
  /** C1 — corpo da mensagem que abre o Flow. */
  openBody:
    'Para marcar, toque em Escolher horário. Você escolhe o serviço, as opções e um horário livre. Depois eu envio a proposta para você confirmar.',
  /** C2 — botão flow_cta (≤30, sem emoji). */
  flowCta: 'Escolher horário',
  /** C3 */
  serviceTitle: 'Serviço',
  /** C4 — vários serviços e nenhum ainda escolhido. */
  serviceBody: 'Qual serviço você quer marcar?',
  /**
   * C4b — um só agendável, ou o turno já trouxe o serviço.
   * O dropdown vem pré-selecionado; Continuar pode seguir.
   */
  serviceBodyReady: (serviceName: string, onlyOne: boolean) => {
    const name = serviceName.trim() || 'Este serviço'
    return onlyOne
      ? `${name} é o único serviço para marcar. Toque em Continuar.`
      : `O serviço já escolhido é ${name}. Toque em Continuar, ou troque se for outro.`
  },
  /** C5 */
  continueLabel: 'Continuar',
  /** C6 */
  genderTitle: 'Versão',
  /** C7 — `{serviço}` = nome do cadastro. */
  genderBody: (serviceName: string) => `Para ${serviceName.trim()}, qual versão?`,
  /** C8 — sem «Todas». O total da visita vai no corpo do horário. */
  variantsBody:
    'Pode marcar mais de uma. O preço está em cada opção; o total aparece no horário.',
  /** C9 */
  slotTitle: 'Horário',
  /** C10 — o total cotado (DEC-080) é acrescentado numa linha, quando existe. */
  slotBody: 'Estes horários estão livres no relógio da clínica.',
  /** C11 */
  slotFooter: 'Ver proposta',
  /** C12 — fallback quando o Flow não abre. */
  openFailed:
    'Não consegui abrir a escolha. Pode me dizer por aqui o que quer marcar.',
  /** C13 — HTTP 427. */
  tokenExpired: 'Esta escolha expirou. Peça de novo no chat.',
  /** C14 */
  catalogChanged: 'O cadastro mudou. Vamos refazer o que deixou de valer.',
  /** C15 */
  slotGone: 'Esse horário já não está livre. Escolha outro.',
  /**
   * C16 — DEC-104. Paulo, 04/11/2026 ~14:34 America/Sao_Paulo: depois do
   * fecho do Flow a cliente ficava em silêncio até ao cartão da proposta.
   * Frase determinística, sem fuso IANA. Não marca (DEC-061).
   */
  preparingProposal:
    'Recebi suas escolhas. Já preparo a proposta para você confirmar.',
} as const

/** Feminina / Masculina — Confirmado (DEC-134). */
export const FLOW_GENDER_LABELS = {
  feminino: 'Feminina',
  masculino: 'Masculina',
} as const
