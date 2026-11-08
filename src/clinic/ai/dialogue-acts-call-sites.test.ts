/**
 * #448 S5 — varredura dos call-sites M4.
 *
 * Aceite: nenhuma frase literal equivalente dos atos das levas 1–2 fica
 * «solta» nos módulos sem estar listada (fallback de sayAct, DEC fixa ou leva 3).
 * Dados fictícios.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DIALOGUE_ACTS, type DialogueActId } from './dialogue-acts'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Módulos do funil listados na #448 (+ S1–S4) e remarcação DEC-129. */
const CALL_SITE_FILES = [
  'slot-offer.ts',
  'catalog-reply.ts',
  'client-copy.ts',
  'variant-line.ts',
  'autobook.ts',
  'booking-object.ts',
  'reschedule.ts',
] as const

/** Atos com call-site ligado (S1–S4). */
const WIRED_ACTS: readonly DialogueActId[] = [
  'perguntar_linha',
  'perguntar_variantes',
  'oferecer_horarios',
  'sem_vaga_alternativas',
  'informar_preco',
  'informar_preco_sem_cadastro',
  'informar_duracao',
  'informar_expediente',
  'informar_quem_faz',
  'perguntar_dia',
  'perguntar_horario',
  'perguntar_servico',
  'confirmar_servico',
  'confirmar_hora_ambigua',
  'sem_horario_periodo',
  'sem_horario_dia',
  'sem_horario_semana',
  'sem_vaga_sem_alternativa',
  'informar_preco_variante',
  'informar_preco_soma',
  'recusar_mistura',
  'servico_inexistente',
  'varios_servicos',
  'historico_indisponivel',
  'catalogo_mudou',
  'nao_consegui_fechar',
  'acolher_adiamento',
]

/** Sem rota natural neste recorte — não inventar call-site. */
const UNWIRED_ACTS: readonly DialogueActId[] = [
  'abrir',
  'informar_local',
  'informar_local_link',
  'informar_explicacao',
  'esclarecer',
]

/**
 * Frases reformadas (Substitui / revisão leva 2) que NÃO podem regressar
 * nem como fallback de sayAct.
 */
const RETIRED_FRAGMENTS: readonly string[] = [
  'Escolha um conjunto compatível — opções que sirvam para os dois também valem',
  'Juntas, ficam',
  'o que a clínica oferece',
  'Sou a assistente da clínica',
  'As {hora} já estão ocupadas',
  'já estão ocupadas. Posso',
]

/**
 * Allowlist explícita (#448): literais que ainda aparecem nos módulos.
 * Inclui fallbacks de sayAct, DEC fixas / leva 3, perguntas sem acto
 * (duração/opção em booking-object) e notas internas à equipe.
 * Qualquer string cliente nova fora desta lista falha o CI.
 */
const ALLOWED_LITERAL_PATTERNS: readonly RegExp[] = [
  // — Fallbacks sayAct (levas 1–2) —
  /^Para \$\{subject\}, \$\{período\} não tenho horário livre\. Quer ver outro período\?$/,
  /^Para \$\{subject\}, \$\{dia\} não tenho horário livre\. Quer ver outro dia\?$/,
  /^Para \$\{subject\}, no momento não tenho horário livre\. Quer que eu veja outra data\?$/,
  /^Para \$\{subject\}, \$\{quando\}tenho \$\{listed\}\. Qual fica melhor\?$/,
  /^Nesse horário das \$\{input\.time\} já não tenho vaga\. Tenho \$\{lista\}\. Qual fica melhor\?$/,
  /^Nesse horário das \$\{input\.time\} já não tenho vaga e o dia está cheio nesse período\. No próximo com vaga tenho \$\{listed\}\. Qual fica melhor\?$/,
  /^Nesse horário das \$\{input\.time\} já não tenho vaga\. Quer que eu veja outro horário\?$/,
  /^Às \$\{hour\} da tarde seria \$\{hora24\}\. É esse horário\?$/,
  /^Qual horário fica melhor para \$\{svc\.name\}\?$/,
  /^Qual horário fica melhor para \$\{det\.service\.name\}\?$/,
  /^Me diga o dia para \$\{det\.service\.name\}\.$/,
  /^Neste momento marcamos um serviço de cada vez\. Qual você quer primeiro\?$/,
  /^Não tenho o detalhe da sua visita anterior aqui\. Qual serviço você quer agora\?$/,
  /^\$\{preço\}, \$\{duração\} min\. Quer que eu veja horários\?$/,
  /^a equipe confirma o valor$/,
  /^A equipe confirma o valor\.$/,
  /^Não dá para juntar masculino e feminino na mesma visita\. Quer escolher só um dos dois\?$/,
  /^Não entendi bem esse pedido\. Quer ver as opções que temos\?$/,
  // #509 / prática 1 — zona citada sem match único (Paulo 07/11/2026: sem «ou outra?»)
  /^Não encontrei \$\{palavra\} nas opções\. Quer \$\{lista\}\?$/,
  /^Não encontrei cotovelo nas opções\. Quer Axila, Pernas\?$/,
  /^Nossas opções mudaram\. Pode dizer de novo qual serviço e opção você quer\?$/,
  /^Não consegui fechar \$\{serviceName\} às \$\{time\} agora\. A equipe confirma em seguida\.$/,
  /^\$\{serviço\} feminina ou masculina\?$/,
  /^Para \$\{serviço\}, \$\{whichKind\(variantKind \?\? ''\)\} você quer\? Temos \$\{lista\}\.$/,
  /^Para fechar às \$\{time\}, me diga \$\{phrase\}: \$\{list\}\. Pode ser mais de uma\.$/,
  // DEC-145 modo `uma`: pergunta singular (catálogo M4 permanece plural, máx. 5 redações).
  /^Para fechar às \$\{time\}, \$\{whichKind\(variantKind \?\? ''\)\} você quer\? Temos \$\{list\}\.$/,
  /^Qual serviço você quer\? Temos \$\{lista\}\.$/,
  /^É \$\{serviço\} que você quer agendar\?$/,
  /^Qual serviço você gostaria de agendar\?$/,
  // informar_quem_faz / preço variante (trechos)
  /^\$\{s\.name\}: \$\{names\.length > 0 \? names\.join\(', '\) : 'a equipe confirma quem atende'\}\.$/,
  /^A equipe confirma quem atende\.$/,
  // — booking-object: perguntas sem acto de catálogo —
  /^Para \$\{serviço\}, qual opção você quer\?$/,
  /^Para \$\{serviço\}, prefere \$\{labels\.join\(' ou '\)\}\?$/,
  /^Para \$\{serviço\}, pode confirmar a opção\?$/,
  /^Qual opção: \$\{labels\.join\(', '\)\}\?$/,
  // — Leva 3 / DEC (allowlist briefing) —
  /^Para agendar para outra pessoa, a equipe precisa continuar este atendimento\.$/,
  // DEC-125: sinal Pix, pausa da owner, envio falhado (sem «Perfeito»/«Anotei»/«Quase lá»)
  /^Para garantir \$\{svc\.name\} na \$\{dayText\(date\)\} às \$\{time\}, a clínica pede um sinal$/,
  /por Pix\. O horário só fica reservado depois do pagamento, e o Pix chega aqui na conversa\./,
  /^Recebi seu pedido de \$\{svc\.name\} na \$\{dayText\(date\)\} às \$\{time\}\. Ainda não está marcado: a equipe confirma o horário e já te retorna\.$/,
  /^Não consegui enviar a confirmação de \$\{serviceName\} na \$\{dayText\(date\)\} às \$\{time\}\. Ainda não está marcado: a equipe vai te responder em seguida\.$/,
  // DEC-129: remarcação (fixas no código, como DEC-125; sem marcador CF-22)
  /^Claro, vamos remarcar\. Para qual dia você prefere\?$/,
  /^Na \$\{dayText\(date\)\} tenho \$\{hours\}\. Algum serve para remarcar\?$/,
  /^Na \$\{dayText\(date\)\} não tenho horário livre\. Quer ver outro dia\?$/,
  /^Às \$\{time\} na \$\{dayText\(date\)\} já não tenho vaga\. Tenho \$\{alternatives\}\. Qual fica melhor\?$/,
  /^Não consegui enviar a confirmação da remarcação para \$\{dayText\(date\)\} às \$\{time\}\. $/,
  /^Ainda não está remarcado: a equipe vai te responder em seguida\.$/,
  /^Recebi seu pedido de remarcar \$\{serviceName\} para \$\{dayText\(date\)\} às \$\{time\}\. $/,
  // DEC-131: variante sem nome do serviço quando o nome tem termo proibido
  /^Recebi seu pedido de remarcar\. Ainda não está remarcado: a equipe confirma e já te retorna\.$/,
  /^Ainda não está remarcado: a equipe confirma e já te retorna\.$/,
  // — Notas internas à equipe (não WhatsApp cliente) —
  /Texto livre não marca/,
  /Confirme com a cliente/,
  /Pergunta automática enviada/,
  /Não informe valor/,
  /Não se infere pelo nome/,
  /Não deu para calcular/,
  /O horário das \$\{time\} não passa no tempo/,
  /A equipe vê o alerta/,
  /próximo com vaga/,
  /A cliente parece confirmar/,
  /A cliente confirmou/,
  /Capacidade pausada/,
  /Proposta \$\{proposal\.id\}/,
  /Aguarda o clique da cliente/,
  /Envie a cobrança Pix/,
  /Serviço exige sinal/,
  /Falha ao montar\/enviar a proposta/,
  /Falha ao montar proposta de remarcação/,
  /Agendamento pela IA não feito/,
  /As \$\{kind\} escolhidas misturam/,
  /O nome citado casa com mais de uma/,
  /A cliente falou em \$\{svc\.name\} sem escolher/,
  /Aviso automático enviado — confirme pelo Agendar/,
  /termos proibidos à cliente/,
  /Remarcação do compromisso/,
  /Sem vagas para remarcar/,
  /Oferta de remarcação/,
  /Horário \$\{time\} indisponível para remarcar/,
  /Proposta de remarcação/,
  /reschedule phrase:/,
]

function readCallSite(file: string): string {
  return readFileSync(join(HERE, file), 'utf8')
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Extrai literais '…' / "…" / `…` (conteúdo cru, sem as aspas). */
function extractLiterals(src: string): string[] {
  const out: string[] = []
  const re = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g
  for (const m of src.matchAll(re)) out.push(m[2] ?? '')
  return out
}

/** Heurística: candidato a frase à cliente ou nota operacional em PT. */
function looksLikeClientOrOpsCopy(s: string): boolean {
  if (s.length < 20 || s.length > 280) return false
  // IDs de acto / snake_case / paths — não são copy.
  if (/^[a-z0-9_]+$/.test(s)) return false
  if (/^(src\/|\.\/|\.\.\/|node:|vitest|clinic\/)/.test(s)) return false
  if (!/\s/.test(s)) return false
  return /(Qual |Para |Não |Me |Neste|Nossas|Quase|Anotei|Perfeito|Claro|Recebi|equipe|serviço|horário|vaga|opção|prefere|gostaria|agendar|remarcar|confirmar|Temos|Pix|proposta|cliente|Texto livre|Agendar|termos proibidos)/i.test(
    s,
  )
}

function isAllowed(literal: string): boolean {
  return ALLOWED_LITERAL_PATTERNS.some((re) => re.test(literal))
}

describe('#448 S5 varredura call-sites', () => {
  const sources = Object.fromEntries(CALL_SITE_FILES.map((f) => [f, readCallSite(f)]))
  const joined = Object.values(sources).join('\n')

  it('cobre todos os atos do catálogo (ligados ∪ sem call-site)', () => {
    const all = new Set<DialogueActId>([...WIRED_ACTS, ...UNWIRED_ACTS])
    expect([...all].sort()).toEqual((Object.keys(DIALOGUE_ACTS) as DialogueActId[]).sort())
    expect(WIRED_ACTS).toHaveLength(27)
    expect(UNWIRED_ACTS).toHaveLength(5)
  })

  it('cada ato ligado aparece em sayAct nos módulos do funil', () => {
    for (const act of WIRED_ACTS) {
      expect(joined, `falta sayAct('${act}', …)`).toMatch(
        new RegExp(`sayAct\\(\\s*'${act}'`),
      )
    }
  })

  it('atos sem call-site não foram ligados por engano', () => {
    for (const act of UNWIRED_ACTS) {
      expect(joined, `não ligar ${act} sem rota`).not.toMatch(
        new RegExp(`sayAct\\(\\s*'${act}'`),
      )
    }
  })

  it('fragmentos Substitui / revisão não regressam nos call-sites', () => {
    for (const frag of RETIRED_FRAGMENTS) {
      expect(joined, `regressão: «${frag}»`).not.toContain(frag)
    }
  })

  it('literais PT restantes estão na allowlist explícita', () => {
    const offenders: string[] = []
    for (const [file, raw] of Object.entries(sources)) {
      const literals = extractLiterals(stripComments(raw)).filter(looksLikeClientOrOpsCopy)
      for (const lit of literals) {
        if (!isAllowed(lit)) offenders.push(`${file}: ${JSON.stringify(lit)}`)
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})
