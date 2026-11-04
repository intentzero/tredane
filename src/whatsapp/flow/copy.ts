/**
 * Copy do Flow de agendamento (ADR-0016 §10).
 * Estado: **Proposto** — nenhuma frase nova à cliente está aprovada (DEC-104).
 * Rótulos Confirmados reutilizados: Feminina / Masculina / Todas (DEC-134).
 */
export const FLOW_COPY = {
  /** C1 — corpo da mensagem que abre o Flow. */
  openBody:
    'Para marcar, toque em Escolher horário. Você escolhe o serviço, as opções e um horário livre. Depois eu envio a proposta para você confirmar.',
  /** C2 — botão flow_cta (≤30, sem emoji). */
  flowCta: 'Escolher horário',
  /** C3 */
  serviceTitle: 'Serviço',
  /** C4 */
  serviceBody: 'Qual serviço você quer marcar?',
  /** C5 */
  continueLabel: 'Continuar',
  /** C6 */
  genderTitle: 'Versão',
  /** C7 — `{serviço}` = nome do cadastro. */
  genderBody: (serviceName: string) => `Para ${serviceName.trim()}, qual versão?`,
  /** C8 */
  variantsBody: 'Pode marcar mais de uma. Todas escolhe o conjunto desta versão.',
  /** C9 */
  slotTitle: 'Horário',
  /** C10 */
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
} as const

/** Feminina / Masculina — Confirmado (DEC-134). */
export const FLOW_GENDER_LABELS = {
  feminino: 'Feminina',
  masculino: 'Masculina',
} as const

/** Todas — Confirmado (DEC-134). */
export const FLOW_TODAS_LABEL = 'Todas'
