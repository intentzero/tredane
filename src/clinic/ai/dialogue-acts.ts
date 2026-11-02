/**
 * Atos de diálogo M4 (#414): 3–5 redações por ato, escolha por hash estável.
 * Frases **Propostas** até ok Paulo (DEC-104). DEC-107 e handoffs DEC ficam nos módulos próprios.
 */
import { createHash } from 'node:crypto'
import { validateClientOutbound } from './outbound-validate'

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
}

export type DialogueVars = Record<string, string | undefined>

/** Índice estável 0..n-1 a partir do id da conversa (replay determinístico). */
export function dialogueActIndex(conversationId: string, act: DialogueActId, n: number): number {
  if (n <= 1) return 0
  const dig = createHash('sha256').update(`${conversationId}\0${act}`).digest()
  return dig[0]! % n
}

function fill(template: string, vars: DialogueVars): string {
  return template.replace(/\{([a-zçãáéíóúâêôõü_]+)\}/gi, (_, key: string) => {
    if (key === 'nome') {
      const n = vars.nome?.trim()
      return n ? `, ${n}` : ''
    }
    return vars[key] ?? ''
  })
}

/** Variáveis que a redação exige (`{nome}` é opcional: vira vazio sem 1.º contacto). */
function requiredVars(template: string): string[] {
  const out = new Set<string>()
  for (const m of template.matchAll(/\{([a-zçãáéíóúâêôõü_]+)\}/gi)) {
    if (m[1] !== 'nome') out.add(m[1]!)
  }
  return [...out]
}

/**
 * Redações que se podem usar com estas variáveis. Uma redação cujo dado falta (por
 * exemplo, o eco `{assunto}` ou o `{link}`) fica de fora: nunca sai uma frase com buraco.
 */
function usableTemplates(act: DialogueActId, vars: DialogueVars): string[] {
  return DIALOGUE_ACTS[act].filter((t) => requiredVars(t).every((k) => (vars[k] ?? '').trim() !== ''))
}

function finish(template: string, vars: DialogueVars): string {
  return fill(template, vars).replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').trim()
}

/**
 * Todas as redações utilizáveis, preenchidas. Para testes: cada uma tem de passar o
 * validador, e não só a que o hash da conversa escolhe.
 */
export function renderEveryVariant(act: DialogueActId, vars: DialogueVars = {}): string[] {
  return usableTemplates(act, vars).map((t) => finish(t, vars))
}

/**
 * Escolhe e preenche uma redação. Corre o validador único (INV-04/05/11, forma J-07).
 * Enquanto as frases forem Propostas, o call-site decide se as usa (ok Paulo).
 */
export function renderDialogueAct(
  act: DialogueActId,
  conversationId: string,
  vars: DialogueVars = {},
): string {
  const templates = usableTemplates(act, vars)
  if (templates.length === 0) throw new Error(`dialogue-act ${act}: faltam variáveis para qualquer redação`)
  const idx = dialogueActIndex(conversationId, act, templates.length)
  const text = finish(templates[idx]!, vars)
  const check = validateClientOutbound(text, { source: 'phrase', requireSingleQuestion: false })
  if (!check.ok) {
    throw new Error(`dialogue-act ${act}: ${check.reason}${check.detail ? ` (${check.detail})` : ''}: ${text}`)
  }
  return text
}
