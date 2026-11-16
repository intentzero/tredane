/**
 * Limites da Cloud API para mensagens interactive (botões reply).
 * Módulo folha — sem imports — para evitar TDZ em asserts de load nos follow-ups
 * quando há ciclo render ↔ human-handoff ↔ autobook ↔ post-booking.
 */

/** Limite Cloud API para título de botão reply. */
export const PROPOSAL_BUTTON_TITLE_MAX = 20

/** Limite Cloud API para corpo de mensagem interactive. */
export const PROPOSAL_BODY_MAX = 1024
