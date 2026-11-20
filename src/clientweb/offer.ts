/**
 * Oferta do link da página web da cliente no chat (ADR-0018, Fase 5; DEC-196).
 *
 * A frase é determinística (DEC-104): a abertura do hub do chat passa a levar o botão «Abrir agenda»
 * em vez do CTA do Flow. Texto **Proposto** (o do Flow é Confirmado; este ainda não foi revisto).
 */
import type { SendOutboundInteractiveInput } from '../clinic/inbox/types'
import type { ClinicDb } from '../clinic/store'

export const CLIENT_WEB_CTA_TEXT = 'Abrir agenda'

/** Inbound que é só o título do botão «Abrir agenda» (toque ecoado como texto ou colado). */
export function isOpenAgendaButtonTitle(text: string): boolean {
  return text.trim().toLowerCase() === CLIENT_WEB_CTA_TEXT.toLowerCase()
}

/**
 * Botão de resposta rápida «Abrir agenda» (DEC-216): acompanha «Falar com a equipe».
 * O toque dispara o envio do CTA URL real (não se mistura com reply buttons na mesma mensagem).
 * Opcional: `cw:abrir-agenda:<serviceId>` pré-escolhe o serviço (DEC-202(4)).
 */
export const OPEN_AGENDA_REPLY_BUTTON_ID = 'cw:abrir-agenda'
const OPEN_AGENDA_REPLY_BUTTON_PREFIX = 'cw:abrir-agenda:'

export function openAgendaReplyButton(serviceId?: string | null): { id: string; title: string } {
  const sid = serviceId?.trim()
  return {
    id: sid ? `${OPEN_AGENDA_REPLY_BUTTON_PREFIX}${sid}` : OPEN_AGENDA_REPLY_BUTTON_ID,
    title: CLIENT_WEB_CTA_TEXT,
  }
}

export function parseOpenAgendaReplyButton(raw: string): { serviceId: string | null } | null {
  const id = raw.trim()
  if (id === OPEN_AGENDA_REPLY_BUTTON_ID) return { serviceId: null }
  if (id.startsWith(OPEN_AGENDA_REPLY_BUTTON_PREFIX)) {
    const sid = id.slice(OPEN_AGENDA_REPLY_BUTTON_PREFIX.length).trim()
    return { serviceId: sid || null }
  }
  return null
}

/** Remate da abertura do hub: troca a pergunta aberta pela indicação do botão. */
const HUB_ASK = /\s*O que você precisa\?\s*$/

export const CLIENT_WEB_OFFER_SENTENCE =
  'Para agendar, remarcar ou cancelar, toque em «Abrir agenda». Para tirar dúvidas, escreva aqui.'

/** Corpo da oferta a partir do corpo do hub (expediente de hoje incluído). */
export function clientWebOfferBody(hubBody: string | null | undefined): string {
  const base = (hubBody ?? '').trim().replace(HUB_ASK, '').trim()
  return base ? `${base} ${CLIENT_WEB_OFFER_SENTENCE}` : `Olá! ${CLIENT_WEB_OFFER_SENTENCE}`
}

/** `https://app/c/<token>`; a base vem de `APP_BASE_URL`, sem barra final. */
export function clientWebUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/c/${token}`
}

export function clientWebOfferInteractive(url: string): SendOutboundInteractiveInput {
  return { ctaUrl: { displayText: CLIENT_WEB_CTA_TEXT, url } }
}

/** A página só vai por https; em desenvolvimento (http://localhost) não há envio real. */
export function isHttpsBase(baseUrl: string | undefined): baseUrl is string {
  return typeof baseUrl === 'string' && /^https:\/\//i.test(baseUrl.trim())
}

/** Finalidade do link (ADR-0018): abre a página já no ecrã de remarcar ou de cancelar. */
export type ClientWebOfferPurpose = 'remarcar' | 'cancelar'

export const CLIENT_WEB_RESCHEDULE_BODY =
  'Para remarcar, toque em «Abrir agenda» e escolha a nova data e hora. Se tiver dúvidas, escreva aqui.'

export const CLIENT_WEB_CANCEL_BODY =
  'Para cancelar, toque em «Abrir agenda» e confirme a marcação. Se tiver dúvidas, escreva aqui.'

export const CLIENT_WEB_BOOK_BODY =
  'Para agendar, toque em «Abrir agenda» e escolha o dia e a hora. Se tiver dúvidas, escreva aqui.'

export const CLIENT_WEB_NO_UPCOMING_BODY =
  'Não encontrei marcações futuras no seu nome. Para agendar, toque em «Abrir agenda». Se tiver dúvidas, escreva aqui.'

/** Aceite de hora por texto («Pode ser as 10:15»): o chat não marca; reenvia o botão (DEC-202). */
export const CLIENT_WEB_TIME_PICK_BODY =
  'Para escolher data e hora, toque em «Abrir agenda». O chat não marca nem remarca por texto. Se tiver dúvidas, escreva aqui.'


/**
 * Corpo fixo do encaminhamento (DEC-202). Com um serviço reconhecido, nomeia-o: a página abre
 * nele. Texto **Proposto**.
 */
export function clientWebRouteBody(input: {
  purpose: 'agendar' | 'remarcar' | 'cancelar'
  serviceName?: string | null
  noUpcoming?: boolean
}): string {
  if (input.purpose === 'remarcar') return CLIENT_WEB_RESCHEDULE_BODY
  if (input.purpose === 'cancelar') return CLIENT_WEB_CANCEL_BODY
  if (input.noUpcoming) return CLIENT_WEB_NO_UPCOMING_BODY
  const name = input.serviceName?.trim()
  return name
    ? `Para agendar ${name}, toque em «Abrir agenda» e escolha o dia e a hora. Se tiver dúvidas, escreva aqui.`
    : CLIENT_WEB_BOOK_BODY
}

export type PrepareClientWebOfferInput = {
  tenantId: string
  conversationId: string
  purpose: 'home' | 'agendar' | 'remarcar' | 'cancelar'
  /** A marcação alvo quando a cliente só tem uma futura; senão a página abre as marcações. */
  appointmentId?: string | null
  /** Serviço reconhecido no texto (DEC-202(4)): a página abre nele. */
  serviceId?: string | null
  /** Linha já dita no chat (DEC-200(3) Proposto). */
  audienceLine?: 'feminino' | 'masculino' | null
  /** Zonas já ditas no chat. */
  variantIds?: string[]
  preferredDate?: string | null
  dayPart?: 'manha' | 'tarde' | 'noite' | null
}

/**
 * Gancho do autodraft e do painel: emite o link pessoal e devolve o botão «Abrir agenda».
 * `null` = não há link possível (sem número ativo, base sem https); quem chama passa à equipe.
 */
export type PrepareClientWebOffer = (
  input: PrepareClientWebOfferInput,
) => Promise<SendOutboundInteractiveInput | null>

/** Limite de links enviados pelo chat por conversa e janela (DEC-202): trava quem repete «quero marcar» sem parar. */
export const CLIENT_WEB_LINKS_PER_CONVERSATION = 5
export const CLIENT_WEB_LINKS_WINDOW_MS = 60 * 60 * 1000

/** Quantos links o chat já enviou nesta conversa na janela (mensagens de `ai-web-*`). */
export function countRecentWebLinks(
  db: ClinicDb,
  tenantId: string,
  conversationId: string,
  nowMs: number,
): number {
  return (
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM outbound_messages o
       JOIN messages m ON m.tenant_id = o.tenant_id AND m.id = o.message_id
       WHERE o.tenant_id = ? AND o.conversation_id = ? AND o.client_request_id LIKE 'ai-web-%'
         AND m.created_at > ?`,
      tenantId,
      conversationId,
      nowMs - CLIENT_WEB_LINKS_WINDOW_MS,
    )?.n ?? 0
  )
}

/** Tira do fim da resposta de preço o convite «Quer ver horários?»: o botão «Abrir agenda» já o faz. */
export function stripScheduleOffer(answer: string): string {
  return answer
    .replace(/\s*(Quer (que eu )?(ver|veja) horários\?|Posso te mostrar horários\?)\s*$/i, '')
    .trim()
}
