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
 * Adeus / fecho do redator («Tudo bem, então…», «Por nada! Fico à disposição…»).
 * Nessas bolhas o par reply Abrir agenda|Equipe (DEC-216) não abre a página no toque;
 * preferir `cta_url` Abrir agenda (padrão #990 / Meta: um cta_url, sem misturar reply).
 */
export function looksLikeClosingAssistOutbound(body: string): boolean {
  const t = body.trim().toLocaleLowerCase('pt-BR')
  if (!t) return false
  return (
    /\btudo bem,?\s*ent[aã]o\b/.test(t) ||
    /\bqualquer d[uú]vida\b/.test(t) ||
    /\bfico (?:à|a) disposi/.test(t) ||
    /\bfico por aqui\b/.test(t) ||
    /\bpor nada\b/.test(t) ||
    /\btenha um [oó]timo\b/.test(t) ||
    /\bé s[oó] escrever(?:\s+aqui)?\b/.test(t) ||
    /\bquando (?:você|voce)\s+(?:precisar|quiser)\b/.test(t) ||
    /\bquando quiser\b/.test(t) ||
    /\bestamos por aqui\b/.test(t) ||
    /\bat[eé] (?:l[aá]|breve|logo)\b/.test(t)
  )
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

/**
 * Corpo mínimo da bolha `cta_url` depois do toque «Abrir agenda» no «Posso ajudar…»
 * (DEC-086 Opção A / TRE-81). A Meta exige body; ZWSP passa o trim local e evita a
 * frase redundante `CLIENT_WEB_BOOK_BODY` (TRE-73).
 */
export const CLIENT_WEB_CTA_MINIMAL_BODY = '\u200b'

export const CLIENT_WEB_NO_UPCOMING_BODY =
  'Não encontrei marcações futuras no seu nome. Para agendar, toque em «Abrir agenda». Se tiver dúvidas, escreva aqui.'

/** Aceite de hora por texto («Pode ser as 10:15»): o chat não marca; reenvia o botão (DEC-202). */
export const CLIENT_WEB_TIME_PICK_BODY =
  'Para escolher data e hora, toque em «Abrir agenda». O chat não marca nem remarca por texto. Se tiver dúvidas, escreva aqui.'

/**
 * «Meus agendamentos» / «quero ver as marcações» (TRE-74): o chat não lista horários em texto;
 * envia o link da página (purpose `home`). Texto **Proposto**.
 */
export const CLIENT_WEB_MY_APPOINTMENTS_BODY =
  'Para ver as suas marcações, remarcar ou cancelar, toque em «Abrir agenda». Se tiver dúvidas, escreva aqui.'

export const CLIENT_WEB_MY_APPOINTMENTS_NONE_BODY =
  'Você não tem horário marcado. Para agendar, toque em «Abrir agenda». Se tiver dúvidas, escreva aqui.'

/** Corpo do encaminhamento «meus agendamentos» (com ou sem marcação futura). */
export function clientWebMyAppointmentsBody(hasUpcoming: boolean): string {
  return hasUpcoming ? CLIENT_WEB_MY_APPOINTMENTS_BODY : CLIENT_WEB_MY_APPOINTMENTS_NONE_BODY
}


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
 * `null` = não há link possível (sem número ativo, base sem https); o autodraft envia a
 * frase + reply «Abrir agenda» sem pausar (DEC-202 / TRE-83) — só pausa da owner / teto escalam.
 */
export type PrepareClientWebOffer = (
  input: PrepareClientWebOfferInput,
) => Promise<SendOutboundInteractiveInput | null>

/** Limite de links enviados pelo chat por conversa e janela (DEC-202): trava quem repete «quero marcar» sem parar. */
export const CLIENT_WEB_LINKS_PER_CONVERSATION = 5
export const CLIENT_WEB_LINKS_WINDOW_MS = 60 * 60 * 1000

/**
 * Quantos links «Abrir agenda» o chat já enviou nesta conversa na janela
 * (`ai-web-*` ou `cta_url` no follow-up «Posso ajudar…» / outros).
 */
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
       WHERE o.tenant_id = ? AND o.conversation_id = ?
         AND m.created_at > ?
         AND (
           o.client_request_id LIKE 'ai-web-%'
           OR (
             o.interactive_json LIKE '%ctaUrl%'
             AND o.interactive_json LIKE '%Abrir agenda%'
           )
         )`,
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
