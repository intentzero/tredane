/**
 * Atos de diálogo M4 (#414 / #448): 3–5 redações por ato, escolha por hash estável.
 * Levas 1–2 Confirmadas (DEC-122, DEC-123). DEC-107 e handoffs DEC ficam nos módulos próprios.
 */
import { createHash } from 'node:crypto'
import { MODEL_FALLBACK_TEXT } from './model-fallback'
import { validateClientOutbound } from './outbound-validate'

/** Índice forçado em testes (null = hash da conversa). Só para vitest. */
let forcedVariantForTests: number | null = null

/**
 * Força a n-ésima redação utilizável (módulo n). `null` restaura o hash.
 * O harness L1 e os testes de call-site usam isto para cobrir cada variante.
 */
export function setDialogueVariantForTests(n: number | null): void {
  forcedVariantForTests = n
}

export type DialogueActId =
  | 'abrir'
  | 'perguntar_linha'
  | 'perguntar_variantes'
  | 'oferecer_horarios'
  | 'sem_vaga_alternativas'
  | 'informar_preco'
  | 'informar_preco_sem_cadastro'
  | 'informar_duracao'
  | 'informar_expediente'
  | 'informar_local'
  | 'informar_local_link'
  | 'informar_quem_faz'
  | 'informar_explicacao'
  | 'acolher_adiamento'
  | 'esclarecer'
  | 'perguntar_dia'
  | 'perguntar_horario'
  | 'perguntar_servico'
  | 'confirmar_servico'
  | 'confirmar_hora_ambigua'
  | 'sem_horario_periodo'
  | 'sem_horario_dia'
  | 'sem_horario_semana'
  | 'sem_vaga_sem_alternativa'
  | 'informar_preco_variante'
  | 'informar_preco_soma'
  | 'recusar_mistura'
  | 'servico_inexistente'
  | 'varios_servicos'
  | 'historico_indisponivel'
  | 'catalogo_mudou'
  | 'nao_consegui_fechar'

/** Redações propostas — docs/product/copy-dialogo-atos.md. */
export const DIALOGUE_ACTS: Record<DialogueActId, readonly string[]> = {
  abrir: [
    'Oi{nome}! Aqui é o atendimento virtual da clínica. Quer agendar algum serviço?',
    'Oi{nome}! Em que posso ajudar — marcar um horário ou tirar uma dúvida?',
    'Oi{nome}! Posso te ajudar a marcar ou a ver preços e horários.',
  ],
  perguntar_linha: [
    'Para {serviço}, prefere a opção feminina ou masculina?',
    'Para {serviço}, é na versão feminina ou masculina?',
    'Claro. {serviço} feminina ou masculina?',
  ],
  perguntar_variantes: [
    'Quais {tipo}? Temos {lista}. Pode ser mais de uma.',
    'Quais {tipo} você quer? {lista}. Pode ser mais de uma.',
    'Para {serviço}, quais {tipo}? {lista}.',
    'Perfeito, {assunto}. Quais {tipo}? Temos {lista}. Pode ser mais de uma.',
    'Para fechar às {hora}, quais {tipo}? Temos {lista}. Pode ser mais de uma.',
  ],
  oferecer_horarios: [
    'Para {assunto}, {quando}tenho {lista}. Qual fica melhor?',
    'Os próximos horários para {assunto} são {lista}. Algum serve?',
    'Tenho {lista} para {assunto}. Qual prefere?',
    'Perfeito, {assunto}. Os próximos horários são {lista}. Algum serve?',
  ],
  sem_vaga_alternativas: [
    'Nesse horário das {hora} já não tenho vaga. Tenho {lista}. Qual fica melhor?',
    'Às {hora} já está ocupado. Tenho {lista}. Qual fica melhor?',
    'Nesse horário das {hora} já não tenho vaga e o dia está cheio nesse período. No próximo com vaga tenho {lista}. Qual fica melhor?',
  ],
  informar_preco: [
    '{preço}, {duração} min. Quer que eu veja horários?',
    'Fica {preço} e dura {duração} min. Quer ver horários?',
    'O valor é {preço} ({duração} min). Posso te mostrar horários?',
  ],
  informar_preco_sem_cadastro: ['A equipe confirma o valor.'],
  informar_duracao: ['{duração} min.', 'A sessão dura {duração} min.'],
  informar_expediente: [
    'Funcionamos assim:\n{lista}',
    'Nosso horário:\n{lista}',
    'Abrimos assim:\n{lista}',
  ],
  informar_local: [
    'Ficamos em {endereço}.',
    'O endereço é {endereço}.',
    'Estamos em {endereço}.',
  ],
  informar_local_link: [
    'Ficamos em {endereço}. Para chegar: {link}',
    'O endereço é {endereço}. Para chegar: {link}',
  ],
  informar_quem_faz: [
    'Quem atende: {pessoas}.',
    'Esse atendimento é feito por {pessoas}.',
    'Nesse serviço, quem atende é {pessoas}.',
  ],
  informar_explicacao: ['{explicação}', 'Sobre isso: {explicação}'],
  acolher_adiamento: [
    'Sem problema. Quando quiser, é só chamar.',
    'Tudo bem! Fico por aqui quando você decidir.',
    'Fica à vontade. Qualquer coisa, me chama.',
  ],
  esclarecer: [
    'Pode me dizer de outro jeito, ou prefere falar com a equipe?',
    'Não peguei bem — prefere reformular ou chamar a equipe?',
  ],
  // — Leva 2 (Confirmada, DEC-123): funil de marcação. A 1.ª redação de cada ato é, quando existe,
  //   o texto que o código já envia hoje; as restantes são novas. Ver docs/product/copy-dialogo-atos.md.
  perguntar_dia: [
    'Para {serviço}, qual dia fica melhor?',
    'Qual dia você prefere para {serviço}?',
  ],
  perguntar_horario: [
    'Qual horário fica melhor para {serviço}?',
    'Para {serviço}, qual horário você prefere?',
  ],
  perguntar_servico: [
    'Qual serviço você quer? Temos {lista}.',
    'Claro! Qual serviço? Temos {lista}.',
    'Qual serviço você gostaria de agendar?',
  ],
  confirmar_servico: ['É {serviço} que você quer agendar?', 'Seria {serviço}?'],
  confirmar_hora_ambigua: ['Você quis dizer {hora24}, à tarde?'],
  sem_horario_periodo: [
    'Para {assunto}, {período} não tenho horário livre. Quer ver outro período?',
    '{período} não tenho nada livre para {assunto}. Prefere outro período?',
  ],
  sem_horario_dia: [
    'Para {assunto}, {dia} não tenho horário livre. Quer ver outro dia?',
    'Não tenho horário livre para {assunto} {dia}. Prefere outro dia?',
  ],
  sem_horario_semana: [
    'Para {assunto}, no momento não tenho horário livre. Quer que eu veja outra data?',
    'No momento não tenho horário livre para {assunto}. Quer que eu veja outra data?',
  ],
  sem_vaga_sem_alternativa: [
    'Nesse horário das {hora} já não tenho vaga. Quer que eu veja outro horário?',
    'Às {hora} já está ocupado e não tenho outra opção nesse dia. Quer que eu veja outro dia?',
  ],
  informar_preco_variante: [
    '{variante} custa {preço} e dura {duração} min.',
    'Para {variante}, o valor é {preço} e a duração, {duração} min.',
  ],
  informar_preco_soma: [
    'No total, ficam {preço} e {duração} min de atendimento.',
    'Somando tudo, ficam {preço} e {duração} min de atendimento.',
  ],
  recusar_mistura: [
    'Não dá para juntar masculino e feminino na mesma visita. Quer escolher só um dos dois?',
    'Masculino e feminino não entram na mesma visita. Qual dos dois prefere?',
  ],
  servico_inexistente: [
    'Não encontrei esse procedimento por aqui. Quer ver as opções que temos?',
    'Esse serviço eu não encontrei por aqui. Quer ver o que oferecemos?',
  ],
  varios_servicos: [
    'Neste momento marcamos um serviço de cada vez. Qual você quer primeiro?',
    'Marcamos um serviço de cada vez. Por qual quer começar?',
  ],
  historico_indisponivel: [
    'Não tenho o detalhe da sua visita anterior aqui. Qual serviço você quer agora?',
    'Não consegui ver a sua visita anterior por aqui. Qual serviço você quer agora?',
  ],
  catalogo_mudou: ['Nossas opções mudaram. Pode dizer de novo qual serviço e opção você quer?'],
  nao_consegui_fechar: ['Não consegui fechar {serviço} às {hora} agora. A equipe confirma em seguida.'],
}

export type DialogueVars = Record<string, string | undefined>

/** Índice estável 0..n-1 a partir do id da conversa (replay determinístico). */
export function dialogueActIndex(conversationId: string, act: DialogueActId, n: number): number {
  if (n <= 1) return 0
  const dig = createHash('sha256').update(`${conversationId}\0${act}`).digest()
  return dig[0]! % n
}

function fill(template: string, vars: DialogueVars): string {
  return template.replace(/\{([a-zçãáéíóúâêôõü_0-9]+)\}/gi, (_, key: string) => {
    if (key === 'nome') {
      const n = vars.nome?.trim()
      return n ? `, ${n}` : ''
    }
    return vars[key] ?? ''
  })
}

/**
 * Variáveis que a redação exige.
 * `{nome}` e `{quando}` são opcionais: nome só no 1.º contacto; quando = período com
 * espaço final ou vazio («de manhã » / «»).
 */
function requiredVars(template: string): string[] {
  const out = new Set<string>()
  for (const m of template.matchAll(/\{([a-zçãáéíóúâêôõü_0-9]+)\}/gi)) {
    if (m[1] !== 'nome' && m[1] !== 'quando') out.add(m[1]!)
  }
  return [...out]
}

/**
 * Redações que se podem usar com estas variáveis. Uma redação cujo dado falta (por
 * exemplo, o eco `{assunto}` ou o `{link}`) fica de fora: nunca sai uma frase com buraco.
 * Se `{quando}` veio preenchido (período pedido), preferimos as redações que o ecoam.
 */
function usableTemplates(act: DialogueActId, vars: DialogueVars): string[] {
  const base = DIALOGUE_ACTS[act].filter((t) =>
    requiredVars(t).every((k) => (vars[k] ?? '').trim() !== ''),
  )
  const quando = (vars.quando ?? '').trim()
  if (!quando) return base
  const withQuando = base.filter((t) => t.includes('{quando}'))
  return withQuando.length > 0 ? withQuando : base
}

function finish(template: string, vars: DialogueVars): string {
  const text = fill(template, vars).replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').trim()
  // Início de frase em maiúscula, mesmo quando abre por uma variável («de manhã não tenho…»).
  return text.replace(/^(\P{L}*)(\p{L})/u, (_m, lead: string, c: string) => lead + c.toLocaleUpperCase('pt-BR'))
}

/** Filtra redações por substring do template (ex.: «próximo com vaga» só no rollover). */
export type DialogueActPick = {
  /** Só templates que contenham todos estes trechos. */
  requireInTemplate?: readonly string[]
  /** Exclui templates que contenham algum destes trechos (se sobrar pelo menos um). */
  avoidInTemplate?: readonly string[]
}

function pickTemplates(act: DialogueActId, vars: DialogueVars, pick?: DialogueActPick): string[] {
  let templates = usableTemplates(act, vars)
  if (pick?.requireInTemplate?.length) {
    const req = templates.filter((t) => pick.requireInTemplate!.every((s) => t.includes(s)))
    if (req.length > 0) templates = req
  }
  if (pick?.avoidInTemplate?.length) {
    const avoid = templates.filter((t) => pick.avoidInTemplate!.every((s) => !t.includes(s)))
    if (avoid.length > 0) templates = avoid
  }
  return templates
}

/**
 * Todas as redações utilizáveis, preenchidas. Para testes: cada uma tem de passar o
 * validador, e não só a que o hash da conversa escolhe.
 */
export function renderEveryVariant(
  act: DialogueActId,
  vars: DialogueVars = {},
  pick?: DialogueActPick,
): string[] {
  return pickTemplates(act, vars, pick).map((t) => finish(t, vars))
}

/**
 * Escolhe e preenche uma redação. Corre o validador único (INV-04/05/11, forma J-07).
 * Lança se faltarem variáveis ou se o validador recusar — nos fluxos use `sayAct`.
 */
export function renderDialogueAct(
  act: DialogueActId,
  conversationId: string,
  vars: DialogueVars = {},
  pick?: DialogueActPick,
): string {
  const templates = pickTemplates(act, vars, pick)
  if (templates.length === 0) throw new Error(`dialogue-act ${act}: faltam variáveis para qualquer redação`)
  const n = templates.length
  const idx =
    forcedVariantForTests != null
      ? ((forcedVariantForTests % n) + n) % n
      : dialogueActIndex(conversationId, act, n)
  const text = finish(templates[idx]!, vars)
  const check = validateClientOutbound(text, { source: 'phrase', requireSingleQuestion: false })
  if (!check.ok) {
    throw new Error(`dialogue-act ${act}: ${check.reason}${check.detail ? ` (${check.detail})` : ''}: ${text}`)
  }
  return text
}

/**
 * Call-site seguro (#448): captura erro do catálogo, regista sem texto da conversa,
 * e devolve o literal anterior (ou a frase DEC-107). O erro nunca propaga à cliente.
 */
export function sayAct(
  act: DialogueActId,
  conversationId: string,
  vars: DialogueVars,
  fallbackLiteral: string,
  pick?: DialogueActPick,
): string {
  try {
    return renderDialogueAct(act, conversationId, vars, pick)
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    const reason = msg.includes('faltam variáveis')
      ? 'missing_vars'
      : msg.includes('dialogue-act')
        ? 'validate_or_render'
        : 'error'
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'ai.dialogue_act_fallback',
        act,
        reason,
      }),
    )
    const fb = fallbackLiteral.trim()
    return fb.length > 0 ? fb : MODEL_FALLBACK_TEXT
  }
}
