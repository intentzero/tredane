/**
 * Copy do Flow de agendamento (ADR-0016 §10) + hub TR-306.
 * C1–C15 / C16: **Confirmado** (Paulo, 04/11/2026 America/Sao_Paulo, opção A, DEC-104).
 * Revisão no mesmo dia, após o open em staging (~14:34): C4b, C8 e C16.
 * Rótulos Confirmados reutilizados no Flow: Feminina / Masculina (DEC-134).
 * «Todas» do M5 não entra no CheckboxGroup (Paulo, 04/11/2026, «Podemos retirar o Todas»).
 *
 * Hub (C1h / C2h / HUB-* / Meus / Informações): **Confirmado**
 * (Paulo, 04/11/2026, DEC-104 — aceite do pacote hub).
 * C1h (Paulo, 05/11/2026): uma frase com o horário de hoje
 * («Hoje funcionamos das {abre} às {fecho}»), dentro ou fora da janela.
 * Sem «Já estamos fechados», «Ainda não abrimos» ou «Posso ajudar a agendar mesmo assim?».
 * A frase fechada da opção A (04/11/2026) fica revogada. CTA Abrir opções inalterado.
 * Título «Agendar» Confirmado pelo Paulo para o HUB (excepção explícita ao jargão INV-05 do painel).
 */
export const FLOW_COPY = {
  /**
   * C1h — corpo por omissão quando o preparador não interpola clínica/hora.
   * Preferir `hubOpeningBody` em `hub-opening.ts`.
   */
  openBody: 'Olá! O que você precisa?',
  /**
   * C2h — botão flow_cta (≤30, sem emoji). Confirmado (Paulo, 04/11/2026).
   */
  flowCta: 'Abrir opções',
  /** HUB-body — Confirmado. */
  hubBody: 'O que você quer fazer?',
  /**
   * HUB opções — Confirmadas (Paulo, 04/11/2026), ≤30.
   * Ids estáveis: agendar|remarcar|cancelar|meus|informacoes|equipe.
   */
  hubAgendar: 'Agendar',
  hubRemarcar: 'Remarcar',
  hubCancelar: 'Cancelar',
  hubMeus: 'Meus agendamentos',
  hubInformacoes: 'Informações',
  hubEquipe: 'Falar com a equipe',
  /** Meus — Confirmado. */
  hubMeusNone: 'Você não tem horário marcado. Quer agendar?',
  hubMeusList: (n: number, lista: string) =>
    `Você tem ${n}: ${lista}. Quer remarcar algum?`,
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
   * Staging 04/11 ~19:31 America/Sao_Paulo: tem de sair **antes** do cálculo
   * da proposta (DO single-thread + claim Meta); senão a cliente fica no vácuo
   * e reabre o Flow.
   * Staging 04/11 ~21:11 America/Sao_Paulo: **só** depois de fecho Agendar
   * com payload de horário bookable (HORARIO / slot_id). Nunca após Abrir
   * opções, stubs do hub, SERVICO incompleto, dismiss ou nfm vazio.
   */
  preparingProposal:
    'Recebi suas escolhas. Já preparo a proposta para você confirmar.',
  /**
   * C16b — **Proposto** (fumo staging 04/11/2026): se a proposta falhar depois
   * do C16, nunca silêncio. Não marca (DEC-061). Sem fuso IANA.
   * Só depois de C16 ter sido prometido neste `providerEventKey`.
   */
  proposalBuildFailed:
    'Não consegui montar a proposta agora. Toque de novo em Abrir opções, ou diga aqui o que quer marcar.',
  /**
   * Fecho sem payload bookable (hub incompleto / dismiss / nfm vazio) —
   * **Proposto** (fumo staging 04/11 ~21:11 America/Sao_Paulo, Paulo:
   * «Porque falou a proposta?»). Sem C16/C16b. Sem fuso IANA.
   */
  flowClosedContinue: 'Pode continuar no menu quando quiser.',
} as const

/** Ids estáveis das acções do HUB (payload / SUCCESS params). */
export const FLOW_HUB_ACTIONS = [
  'agendar',
  'remarcar',
  'cancelar',
  'meus',
  'informacoes',
  'equipe',
] as const
export type FlowHubAction = (typeof FLOW_HUB_ACTIONS)[number]

export function isFlowHubAction(raw: unknown): raw is FlowHubAction {
  return (
    raw === 'agendar' ||
    raw === 'remarcar' ||
    raw === 'cancelar' ||
    raw === 'meus' ||
    raw === 'informacoes' ||
    raw === 'equipe'
  )
}

/** Acções que fecham o Flow sem funil Agendar. */
export type FlowHubStubAction = Exclude<FlowHubAction, 'agendar'>

export function isFlowHubStubAction(raw: unknown): raw is FlowHubStubAction {
  return isFlowHubAction(raw) && raw !== 'agendar'
}

/** Feminina / Masculina — Confirmado (DEC-134). */
export const FLOW_GENDER_LABELS = {
  feminino: 'Feminina',
  masculino: 'Masculina',
} as const
