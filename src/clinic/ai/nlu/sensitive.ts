/**
 * Classificador único de handoff e temas sensíveis (#409 / CF-02, 03, 04, 13, 18).
 * Listas partilhadas por human-handoff, rules e reschedule. Sem copy nova à cliente.
 */
import {
  detectStrongInjectionSignals,
  detectWeakInjectionSignals,
} from '../../../ai/untrusted'
import { HEALTH_RE, OFFENSE_RE } from '../../../ai/sensitive-lexicon'

export type SensitiveLabel =
  | 'pedir_pessoa'
  | 'pedir_parar'
  | 'pergunta_ia'
  | 'saude'
  | 'terceiro'
  | 'cancelar'
  | 'remarcar'
  | 'ofensa'
  | 'injecao'
  | 'pergunta_politica'
  /** Recomeçar o funil / limpar BookingFrame (CF-28 / #508). Não pausa a IA. */
  | 'recomecar'
  /**
   * Classes A/B DEC-147: abandono explícito ou despedida após oferta.
   * Limpa o frame e agradece; não pausa a IA e não marca (DEC-061 / DEC-104).
   */
  | 'desistir'
  /**
   * Classe C DEC-147: rejeita a oferta actual de horários sem abandonar a sessão.
   */
  | 'rejeitar_oferta'

export type InjectionStrength = 'fraca' | 'forte'

export type SensitiveHit = {
  label: SensitiveLabel
  injectionStrength?: InjectionStrength
  matchedBy?: string
}

/**
 * Pedido explícito de pessoa/equipe (DEC-083). Lista fechada — sem LLM (DEC-104).
 *
 * rsamp_fa7f138 (13/11/2026): «Posso falar com um atendente?» não casava (só o
 * artigo «a» era aceite) e caía no funil como «Não encontrei falar nas opções».
 * Agora: verbo de pedido («falar/conversar com», «me passa/transfere pra»,
 * «chama», «quero/preciso de») + artigo opcional + alvo humano; ou a mensagem
 * inteira só com o alvo («humano», «atendente»). «pessoa» isolada (ex.: «são
 * duas pessoas», «para uma pessoa») não casa — precisa do verbo de pedido.
 * Corre também sobre o texto sem acentos (ver `wantsHumanText`).
 */
const HUMAN_TARGET = String.raw`(?:(?:o|a|um|uma|algum|alguma)\s+)?(?:atendente(?:\s+humano)?|atendimento\s+humano|humano|humana|pessoa(?:\s+(?:real|de\s+verdade))?|algu[eé]m|equipe|equipa|recepcionista|recep[cç][aã]o)`
/** Vocativo carinhoso («boa tarde minha filha», «obrigada minha filha») — não é agendar para terceiro. */
export const FAMILY_VOCATIVE_RE =
  /(?:^|(?:boa\s+tarde|boa\s+noite|bom\s+dia|oi|ol[aá]|obrigad[oa]|valeu)[,.\s!]+)(?:minha|meu)\s+(?:filha|filho)\b/i

export const WANTS_HUMAN_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:` +
    [
      // «tem uma pessoa aí?», «tem alguém?»
      String.raw`tem\s+(?:uma\s+)?(?:pessoa|gente|algu[eé]m)(?:\s+a[ií]|\s+ai)?\s*[?!.…]*`,
      // «não tô entendendo… desse robô»
      String.raw`n[aã]o\s+(?:t[oô]|estou)\s+entendendo\b[^.?\n]{0,48}\b(?:rob[oô]|bot)\b`,
      String.raw`n[aã]o\s+(?:t[oô]|estou)\s+entendendo\s+nada\b`,
      // «prefiro ligar» / telefone da clínica
      String.raw`(?:prefiro|quero)\s+ligar\b`,
      String.raw`telefone\b[^.?\n]{0,40}\bprefiro\s+ligar\b`,
      // «falar com um atendente», «posso conversar com alguém?»
      String.raw`(?:falar|conversar)\s+com\s+${HUMAN_TARGET}`,
      // «me passa pra alguém», «me transfere para um humano», «passa pra equipe»
      String.raw`(?:me\s+)?(?:passa|passe|passar|transfere|transfira|transferir|encaminha|encaminhe|encaminhar|coloca|coloque|bota)\s+(?:pra|para|com)\s+${HUMAN_TARGET}`,
      // «chama um atendente», «chame alguém»
      String.raw`(?:chama|chame|chamar)\s+${HUMAN_TARGET}`,
      // «quero um atendente», «quero uma pessoa», «preciso de um humano»
      String.raw`(?:quero|queria|gostaria\s+de|preciso\s+de|prefiro)\s+(?:ser\s+atendid[oa]\s+por\s+)?${HUMAN_TARGET}`,
      String.raw`atendimento\s+humano`,
      // Mensagem inteira só com o alvo: «humano», «um atendente?», «pessoa real».
      String.raw`^\s*(?:(?:o|a|um|uma)\s+)?(?:atendente(?:\s+humano)?|humano|pessoa\s+real)\s*[?!.…]*\s*$`,
    ].join('|') +
    String.raw`)(?![\p{L}\p{N}])`,
  'iu',
)

/** Pedido explícito de pessoa, com fold de acentos e caixa (DEC-083). */
export function wantsHumanText(text: string): boolean {
  if (!text?.trim()) return false
  return WANTS_HUMAN_RE.test(text) || WANTS_HUMAN_RE.test(fold(text))
}

/**
 * Pedido para parar mensagens (DEC-114). Singular e plural (CF-37, sonda L4 05/11/2026):
 * «parem de me mandar mensagens», «parem de mandar mensagens automáticas»,
 * «não quero receber mensagens», «não me mandem mais», «chega de mensagens».
 */
export const STOP_MESSAGES_RE =
  /\b(par(?:e|em|a|ar)\s+de\s+(?:me\s+)?(?:mandar|enviar)\b|n[aã]o\s+(?:quero|queria)\s+(?:mais\s+)?(?:receber\s+)?(?:mais\s+)?mensage(?:m|ns)\b|n[aã]o\s+me\s+(?:mande|mandem|envie|enviem)\s+mais\b|chega\s+de\s+mensage(?:m|ns)\b)/i

/**
 * Transparência sobre IA (DEC-115). Antes da injeção fraca «você é atendente».
 * Não cobre elogio («ótima atendente»).
 */
export const AI_TRANSPARENCY_RE =
  // Fronteiras Unicode explícitas: sem `u`, `\b` trata «é»/«ô» como não-letra e
  // «é robô?» nunca casava (sonda L4 05/11/2026).
  /(?<![\p{L}\p{N}])(?:[eé]\s+(?:um\s+)?(?:rob[oô]|bot)|estou\s+falando\s+com\s+(?:uma\s+)?pessoa|voc[eê]\s+[eé]\s+(?:a\s+)?atendente|(?:atendente|pessoa).{0,20}rob[oô]|rob[oô].{0,20}(?:atendente|pessoa))(?![\p{L}\p{N}])/iu

export { HEALTH_RE, OFFENSE_RE }

export const OFF_TOPIC_RE = /\b(piada|esquece a cl[ií]nica)\b/i

/**
 * Conversa fiada (piada). Não pausa a IA: o autodraft redireciona.
 * «esquece a clínica» continua no handoff (exclusão do recomeço).
 * Injeção forte no mesmo texto não é conversa fiada.
 */
export function isOffTopicSmallTalk(text: string): boolean {
  if (!text?.trim() || detectStrongInjectionSignals(text)) return false
  return /\bpiadas?\b/i.test(text)
}
export const PIX_OFF_PURPOSE_RE = /\b(chave\s+pix|j[aá] paguei|pix copia)\b/i

/**
 * Pedido de recomeçar o agendamento (CF-28 / #508 / DEC-138 prática 5).
 * Lista fechada — sem LLM. «outra sessão» / «outra hora» não casam;
 * «esquece a clínica» fica no OFF_TOPIC (exclusão explícita).
 */
export const RESTART_BOOKING_RE =
  /\b(come[cç]ar\s+de\s+novo|recome[cç]ar|quero\s+outra\s+coisa|outra\s+coisa|esquece)\b(?!\s+a\s+cl)/i

/**
 * Classe A DEC-147 — abandono explícito. Lista fechada — sem LLM.
 * Com proposta aberta também limpa (diferente da despedida B / CF-23).
 */
export const EXPLICIT_ABANDON_RE = new RegExp(
  [
    // `(?!\w)` e não `\b` no fim: em JS sem flag `u`, `á` não é `\w`, por isso
    // `\b` após «lá» falha no fim da string («deixa pra lá» → LLM → CPU DO no Lab).
    String.raw`\bdeixa\s+(?:estar|pra\s+l[aá]|para\s+l[aá]|assim)(?!\w)`,
    String.raw`^(?:ok[,.\s!]*)?deixa[.!?\s]*$`,
    String.raw`\bpor\s+agora\s+n[aã]o\b`,
    // Fecho «por agora é só» / «é só isso» (lab TRE-82: senão o redator
    // responde com reply Abrir agenda|Equipe que não abre a página).
    String.raw`\bpor\s+(?:agora|enquanto)\s+(?:[eé]\s+)?s[oó]\b`,
    String.raw`^(?:(?:ok|beleza|obrigad[oa]|valeu)[,.\s!]*)*(?:[eé]\s+)?s[oó]\s+(?:isso|por\s+agora|por\s+enquanto)(?:\s+mesmo)?[.!?\s]*$`,
    // Bare «não quero» / mais|agora|agendar|marcar; ou «não quero, obrigada».
    // «não quero pernas, só axila» é correção de variante (D3), não abandono A.
    String.raw`\bn[aã]o\s+quero(?:\s+(?:mais|agora|agendar|marcar))?(?:[\s.!?…]*$|\s*[,!]+\s*(?:obrigad[oa]|valeu|tchau)[\s.!?…]*$)`,
    String.raw`\b(?:desisto|desistir)\b`,
    String.raw`\bvou\s+pensar\b`,
    String.raw`\b(?:podes?\s+)?encerrar(?:\s+a\s+sess[aã]o)?\b`,
    // DEC-152: hint «diga terminar» — mensagem exacta (case-insensitive),
    // opcional «a sessão» / «quero|pode|podes|ok» à frente. Não casa
    // «quero terminar depois» (sobra após o fim).
    String.raw`^(?:(?:ok|pode|podes|quero)[,.\s!]*)*terminar(?:\s+a\s+sess[aã]o)?[.!?\s]*$`,
  ].join('|'),
  'i',
)

/**
 * Classe B DEC-147 / DEC-228 — despedida determinística.
 *
 * A mensagem inteira precisa casar: nunca fechar por substring. Agradecimentos
 * isolados são ambíguos durante um atendimento activo; só podem anteceder uma
 * despedida inequívoca («obrigada, tchau»).
 */
export const FAREWELL_RE = new RegExp(
  String.raw`^(?:(?:ok|beleza|obrigad[oa]|valeu)[,.\s!]*)*(?:`
    + [
      String.raw`tchau`,
      String.raw`xau`,
      String.raw`adeus`,
      String.raw`at[eé]\s+(?:logo|mais|breve|amanh[aã])`,
      String.raw`falamos\s+depois`,
      String.raw`nos\s+falamos`,
      String.raw`era\s+s[oó]\s+isso`,
      String.raw`s[oó]\s+isso\s+por\s+enquanto`,
      String.raw`por\s+(?:agora|enquanto)\s+(?:[eé]\s+)?s[oó]`,
      String.raw`n[aã]o\s+preciso\s+de\s+mais\s+nada`,
    ].join('|')
    + String.raw`)[.!?…\s]*$`,
  'i',
)

/** Confirmação de marcação com agradecimento — não é handoff nem abandono. */
export const BOOKING_ACK_WITH_THANKS_RE =
  /\b(?:sim|pode\s+marcar|confirmo|fechado)\b[\s\S]{0,120}(?:obrigad[oa]|valeu|deus\s+te\s+aben)/iu

/** A ∪ B — classificador; o autobook distingue A vs B. */
export const SOFT_DECLINE_RE = new RegExp(
  `(?:${EXPLICIT_ABANDON_RE.source})|(?:${FAREWELL_RE.source})`,
  'i',
)

/**
 * Classe C DEC-147 — rejeita a oferta de horários sem abandonar.
 * Não casa «não quero» (isso é A).
 */
export const SLOT_REJECT_RE =
  /^(?:n[aã]o(?:\s+serve)?|nenhum(?:a)?(?:\s+(?:destes?|dessas?|deles?|delas?))?|outr[oa](?:\s+hor[aá]rio|\s+hora)?)[.!?\s]*$/i

/** Relógio / hora explícita — a mensagem continua o funil, não desiste. */
const SOFT_DECLINE_CLOCK_RE = /\b\d{1,2}\s*(?::\d{2}|h\b)|[àa]s\s+\d/i

/** Cancelar/desmarcar (acção). */
export const CANCEL_RE = /\b(cancela|cancelar|desmarca|desmarcar)\b/i

/** Remarcar / mudar horário. */
export const RESCHEDULE_RE =
  /\b(reagendar|remarca|remarcar|remarque|adiar|mudar(\s+o)?\s+hor[aá]rio|trocar(\s+o)?\s+hor[aá]rio)\b/i

/**
 * Terceiro real — alinhado a booking-object (não «para a minha pele», CF-03).
 */
export const THIRD_PARTY_RE =
  /\b(pra|para)\s+(minha|meu|o|a)\s+(m[aã]e|pai|irm[aã]|irm[aã]o|esposa|esposo|marido|filho|filha|amiga|amigo|ela|ele)\b|\be\s+pra\s+(ela|ele|outra|outro)\b|\b(agendar|marcar)\s+pra\s+(ela|ele)\b|\b(minha\s+m[aã]e|meu\s+pai|minha\s+filha|meu\s+filho|n[aã]o\s+[eé]\s+para\s+mim)\b/i

/**
 * Pergunta sobre política (CF-04 / E-06) — antes de cancelar.
 * Lab Bloco B: «como funciona o cancelamento se eu marcar?» é FAQ de política,
 * não inexistente DEC-151 nem handoff de cancelar.
 */
export const POLICY_QUESTION_RE =
  /\b(se\s+eu\s+(precisar|tiver\s+que|quiser)\s+(desmarcar|cancelar|remarcar)|caso\s+(eu\s+)?(desmarque|cancele|remarque)|tem\s+multa|qual\s+(a\s+)?pol[ií]tica|como\s+funciona\s+(o\s+)?cancelamento|funciona\s+(o\s+)?cancelamento|pol[ií]tica\s+de\s+cancelamento|taxa\s+de\s+(cancelamento|reagendamento)|posso\s+(desmarcar|cancelar|remarcar)\b[^?]{0,40}\?|(desmarcar|cancelar).{0,40}\b(multa|pol[ií]tica|antes)\b)/i

function fold(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function classifySensitive(text: string): SensitiveHit[] {
  if (!text?.trim()) return []
  const body = String(text)
  const hits: SensitiveHit[] = []

  if (STOP_MESSAGES_RE.test(body)) hits.push({ label: 'pedir_parar', matchedBy: 'stop_messages' })
  if (wantsHumanText(body)) hits.push({ label: 'pedir_pessoa', matchedBy: 'wants_human' })
  if (AI_TRANSPARENCY_RE.test(body)) hits.push({ label: 'pergunta_ia', matchedBy: 'ai_transparency' })
  // Recomeçar / desistir antes de ofensa/saúde: limpam o frame sem pausar.
  if (RESTART_BOOKING_RE.test(body) && !OFF_TOPIC_RE.test(body)) {
    hits.push({ label: 'recomecar', matchedBy: 'restart_booking' })
  }
  // «não quero receber mensagens» é pedir_parar (DEC-114), não abandono A.
  if (
    SOFT_DECLINE_RE.test(body) &&
    !SOFT_DECLINE_CLOCK_RE.test(body) &&
    !RESTART_BOOKING_RE.test(body) &&
    !BOOKING_ACK_WITH_THANKS_RE.test(body) &&
    !hits.some((h) => h.label === 'pedir_parar')
  ) {
    hits.push({ label: 'desistir', matchedBy: 'soft_decline' })
  } else if (SLOT_REJECT_RE.test(body.trim()) && !SOFT_DECLINE_RE.test(body)) {
    hits.push({ label: 'rejeitar_oferta', matchedBy: 'slot_reject' })
  }

  if (detectStrongInjectionSignals(body)) {
    hits.push({ label: 'injecao', injectionStrength: 'forte', matchedBy: 'strong' })
  } else if (detectWeakInjectionSignals(body) && !hits.some((h) => h.label === 'pergunta_ia')) {
    hits.push({ label: 'injecao', injectionStrength: 'fraca', matchedBy: 'role_talk' })
  }

  if (HEALTH_RE.test(body)) hits.push({ label: 'saude', matchedBy: 'health' })
  if (OFFENSE_RE.test(body)) hits.push({ label: 'ofensa', matchedBy: 'offense' })

  if (POLICY_QUESTION_RE.test(body)) {
    hits.push({ label: 'pergunta_politica', matchedBy: 'policy_q' })
  } else if (CANCEL_RE.test(body) && !RESCHEDULE_RE.test(body)) {
    hits.push({ label: 'cancelar', matchedBy: 'cancel' })
  }

  if (RESCHEDULE_RE.test(body)) hits.push({ label: 'remarcar', matchedBy: 'reschedule' })

  if (
    THIRD_PARTY_RE.test(fold(body)) &&
    !FAMILY_VOCATIVE_RE.test(body) &&
    !BOOKING_ACK_WITH_THANKS_RE.test(body)
  ) {
    hits.push({ label: 'terceiro', matchedBy: 'third_party' })
  }

  return hits
}

export function isStrongInjection(hits: SensitiveHit[]): boolean {
  return hits.some((h) => h.label === 'injecao' && h.injectionStrength === 'forte')
}

export function isWeakInjection(hits: SensitiveHit[]): boolean {
  return hits.some((h) => h.label === 'injecao' && h.injectionStrength === 'fraca')
}


/**
 * Motivos que pausam a IA (DEC-083). Não inclui pergunta_politica nem injeção fraca.
 * Ofensa, «esquece a clínica» e pix off-purpose também pausam via handoffReason.
 * Piada é conversa fiada: não pausa.
 */
export function wantsHumanPause(hits: SensitiveHit[]): boolean {
  return hits.some(
    (h) =>
      h.label === 'pedir_pessoa' ||
      h.label === 'pedir_parar' ||
      h.label === 'saude' ||
      h.label === 'terceiro' ||
      h.label === 'ofensa' ||
      (h.label === 'injecao' && h.injectionStrength === 'forte'),
  )
}

export function hasPolicyQuestion(hits: SensitiveHit[]): boolean {
  return hits.some((h) => h.label === 'pergunta_politica')
}

export function hasStopRequest(hits: SensitiveHit[]): boolean {
  return hits.some((h) => h.label === 'pedir_parar')
}

/** Pedido de recomeçar / limpar BookingFrame (CF-28 / #508). */
export function hasRestartRequest(hits: SensitiveHit[]): boolean {
  return hits.some((h) => h.label === 'recomecar')
}

/** Classes A/B DEC-147 — abandono / despedida. Não pausa a IA. */
export function hasSoftDeclineRequest(hits: SensitiveHit[]): boolean {
  return hits.some((h) => h.label === 'desistir')
}

/** Classe A (abandono explícito), não só agradecimento. */
export function isExplicitAbandonText(text: string): boolean {
  return EXPLICIT_ABANDON_RE.test(text) && !SOFT_DECLINE_CLOCK_RE.test(text)
}

/** Classe C DEC-147 — rejeita oferta de slots. Não pausa a IA. */
export function hasSlotRejectRequest(hits: SensitiveHit[]): boolean {
  return hits.some((h) => h.label === 'rejeitar_oferta')
}

export function hasAiTransparencyQuestion(hits: SensitiveHit[]): boolean {
  return hits.some((h) => h.label === 'pergunta_ia')
}


