/**
 * #414 M4: atos de diálogo — hash estável, INV-05 e forma.
 * Dados fictícios. Frases ainda Propostas (ok Paulo).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DIALOGUE_ACTS,
  PROPOSED_ACTS,
  PROPOSED_TEMPLATES,
  dialogueActIndex,
  renderDialogueAct,
  renderEveryVariant,
  type DialogueActId,
} from './dialogue-acts'
import { forbiddenClientTermsIn } from './client-copy'
import { MODEL_FALLBACK_TEXT } from './model-fallback'

const ALL_ACTS = Object.keys(DIALOGUE_ACTS) as DialogueActId[]

describe('#414 dialogue acts', () => {
  it('cada ato tem 1–5 redações', () => {
    for (const act of ALL_ACTS) {
      const n = DIALOGUE_ACTS[act].length
      expect(n, act).toBeGreaterThanOrEqual(1)
      expect(n, act).toBeLessThanOrEqual(5)
    }
  })

  it('dialogueActIndex é estável e cobre 0..n-1', () => {
    expect(dialogueActIndex('cnv_a', 'abrir', 3)).toBe(dialogueActIndex('cnv_a', 'abrir', 3))
    expect(dialogueActIndex('cnv_a', 'abrir', 3)).not.toBe(dialogueActIndex('cnv_b', 'abrir', 3))
    const seen = new Set<number>()
    for (let i = 0; i < 40; i++) {
      seen.add(dialogueActIndex(`cnv_${i}`, 'oferecer_horarios', 3))
    }
    expect(seen.size).toBeGreaterThan(1)
    for (const i of seen) expect(i).toBeGreaterThanOrEqual(0)
    for (const i of seen) expect(i).toBeLessThan(3)
  })

  it('renderDialogueAct preenche nome só quando há primeiro contacto', () => {
    const withName = renderDialogueAct('abrir', 'cnv_1', { nome: 'Carla' })
    expect(withName.startsWith('Oi, Carla!')).toBe(true)
    const noName = renderDialogueAct('abrir', 'cnv_1', {})
    expect(noName.startsWith('Oi!')).toBe(true)
    expect(noName).not.toMatch(/Oi,\s*!/)
  })

  it('todas as redações preenchidas passam INV-05 e saem bem formadas (J-09)', () => {
    const samples: Array<[DialogueActId, Record<string, string>]> = [
      ['abrir', { nome: 'Ana' }],
      ['abrir', {}],
      ['perguntar_linha', { serviço: 'Depilação' }],
      ['perguntar_variantes', { serviço: 'Depilação', tipo: 'zonas', lista: 'Axila, Pernas, Buço', assunto: 'depilação feminina' }],
      ['oferecer_horarios', { assunto: 'Limpeza de pele', quando: 'amanhã ', lista: '09:00, 10:00, 14:00' }],
      ['sem_vaga_alternativas', { hora: '16:00', lista: '15:00, 14:30 ou amanhã às 10:00' }],
      ['informar_preco', { preço: 'R$ 180,00', duração: '60' }],
      ['informar_preco_sem_cadastro', {}],
      ['informar_duracao', { duração: '60' }],
      ['informar_expediente', { lista: 'Seg–Sex 09:00–18:00' }],
      ['informar_local', { endereço: 'Rua Fictícia, 10' }],
      ['informar_local_link', { endereço: 'Rua Fictícia, 10', link: 'https://maps.example.invalid/clinica' }],
      ['informar_quem_faz', { pessoas: 'Gi' }],
      ['informar_quem_faz', { pessoas: 'Gi e Ana' }],
      ['informar_explicacao', { explicação: 'A limpeza remove impurezas da pele.' }],
      ['acolher_adiamento', {}],
      ['esclarecer', {}],
      // Leva 2 (Proposta): funil de marcação.
      ['perguntar_variantes', { serviço: 'Depilação', tipo: 'zonas', lista: 'Axila, Pernas', hora: '10:00' }],
      ['perguntar_dia', { serviço: 'Massagem' }],
      ['perguntar_horario', { serviço: 'Massagem' }],
      ['perguntar_servico', { lista: 'Massagem, Limpeza de pele' }],
      ['confirmar_servico', { serviço: 'Massagem' }],
      ['confirmar_hora_ambigua', { hora24: '15:00' }],
      ['sem_horario_periodo', { assunto: 'Massagem', período: 'de manhã' }],
      ['sem_horario_dia', { assunto: 'Massagem', dia: 'na sexta (06/11)' }],
      ['sem_horario_dia', { assunto: 'Massagem', dia: 'amanhã' }],
      ['sem_horario_semana', { assunto: 'Massagem' }],
      ['sem_vaga_sem_alternativa', { hora: '16:00' }],
      ['informar_preco_variante', { variante: 'Axila feminina', preço: 'R$ 40,00', duração: '15' }],
      ['informar_preco_soma', { preço: 'R$ 160,00', duração: '45' }],
      ['recusar_mistura', {}],
      ['servico_inexistente', {}],
      ['varios_servicos', {}],
      ['historico_indisponivel', {}],
      ['catalogo_mudou', {}],
      ['nao_consegui_fechar', { serviço: 'Massagem', hora: '10:00' }],
    ]
    for (const [act, vars] of samples) {
      const all = renderEveryVariant(act, vars)
      expect(all.length, act).toBeGreaterThan(0)
      for (const text of all) {
        expect(forbiddenClientTermsIn(text), `${act}: ${text}`).toEqual([])
        expect(text.length).toBeGreaterThan(0)
        expect(text.length).toBeLessThanOrEqual(1000)
        // Começa em maiúscula (ou número): uma variável no início não pode deixá-la em minúscula.
        expect(text, `${act}: ${text}`).toMatch(/^[\p{Lu}\d]/u)
        // Sem buracos nem pontuação partida por variável em falta.
        expect(text, `${act}: ${text}`).not.toMatch(/[{}]|,\s*[.!?]|\s[,.!?]|\.\.|:\s*$/)
      }
    }
  })

  it('todo o ato do catálogo é exercitado pelo teste de forma', () => {
    // Impede um ato novo de ficar sem verificação (cada ato tem de aparecer nas amostras acima).
    const src = readFileSync(new URL('./dialogue-acts.test.ts', import.meta.url), 'utf8')
    for (const act of ALL_ACTS) expect(src, `ato ${act} sem amostra`).toContain(`['${act}',`)
  })

  it('a leva 2 (Proposta) não sai em produção até ser aprovada', () => {
    expect(PROPOSED_ACTS.size).toBe(17)
    for (const act of PROPOSED_ACTS) {
      expect(() => renderDialogueAct(act, 'cnv_1', { serviço: 'Massagem', lista: 'A, B', hora: '10:00' }), act).toThrow(/Proposto/)
    }
    // Num ato aprovado, a redação proposta nunca é escolhida pelo hash.
    const vars = { serviço: 'Depilação', tipo: 'zonas', lista: 'Axila, Pernas', hora: '10:00' }
    for (let i = 0; i < 60; i++) {
      const text = renderDialogueAct('perguntar_variantes', `cnv_${i}`, vars)
      expect(text.startsWith('Para fechar às')).toBe(false)
    }
    for (const tpl of PROPOSED_TEMPLATES) expect(DIALOGUE_ACTS.perguntar_variantes).toContain(tpl)
    // Os testes de forma veem as propostas (para as validar antes da aprovação).
    expect(renderEveryVariant('perguntar_variantes', vars).some((x) => x.startsWith('Para fechar às 10:00'))).toBe(true)
    expect(renderEveryVariant('perguntar_variantes', vars, { includeProposed: false }).some((x) => x.startsWith('Para fechar às'))).toBe(false)
  })

  it('correções da revisão da leva 2: preposição, crase, género e voz', () => {
    const dia = renderEveryVariant('sem_horario_dia', { assunto: 'Massagem', dia: 'na sexta (06/11)' })
    expect(dia).toContain('Para Massagem, na sexta (06/11) não tenho horário livre. Quer ver outro dia?')
    expect(dia.every((x) => !/\bem (na|no|sexta|sábado)\b/i.test(x))).toBe(true)
    expect(renderEveryVariant('confirmar_hora_ambigua', { hora24: '13:00' })).toEqual(['Você quis dizer 13:00, à tarde?'])
    const periodo = renderEveryVariant('sem_horario_periodo', { assunto: 'Massagem', período: 'de manhã' })
    expect(periodo.every((x) => /^[\p{Lu}]/u.test(x))).toBe(true)
    // «Juntas» fixa o feminino, mas o tipo da variante é texto livre (DEC-079).
    for (const x of DIALOGUE_ACTS.informar_preco_soma) expect(x).not.toMatch(/^Juntas/)
    for (const x of DIALOGUE_ACTS.servico_inexistente) expect(x).not.toMatch(/a clínica oferece/)
  })

  it('o eco só sai quando há {assunto}; o link só no ato com {link}', () => {
    const semAssunto = renderEveryVariant('perguntar_variantes', { serviço: 'Depilação', tipo: 'zonas', lista: 'Axila, Pernas' })
    // Sem {assunto} e sem {hora} ficam de fora o eco e a variante «Para fechar às {hora}».
    expect(semAssunto.length).toBe(DIALOGUE_ACTS.perguntar_variantes.length - 2)
    expect(semAssunto.every((t) => !t.startsWith('Perfeito') && !t.includes('Para fechar às'))).toBe(true)
    const comAssunto = renderEveryVariant('perguntar_variantes', { serviço: 'Depilação', tipo: 'zonas', lista: 'Axila, Pernas', assunto: 'depilação feminina' })
    expect(comAssunto.some((t) => t.startsWith('Perfeito, depilação feminina.'))).toBe(true)
    // Sem link, o ato com link não tem nenhuma redação utilizável.
    expect(renderEveryVariant('informar_local_link', { endereço: 'Rua Fictícia, 10' })).toEqual([])
    expect(() => renderDialogueAct('informar_local_link', 'cnv_1', { endereço: 'Rua Fictícia, 10' })).toThrow(/faltam variáveis/)
    for (const t of renderEveryVariant('informar_local_link', { endereço: 'Rua Fictícia, 10', link: 'https://maps.example.invalid/c' })) {
      expect(t).toContain('https://maps.example.invalid/c')
    }
  })

  it('correções do Paulo (02/11): crase, concordância e sem género fixo', () => {
    const all = Object.values(DIALOGUE_ACTS).flat()
    expect(all.some((t) => /^As \{hora\}|Posso \{lista\}/.test(t))).toBe(false)
    expect(DIALOGUE_ACTS.sem_vaga_alternativas.some((t) => t.startsWith('Às {hora} já está ocupado. Tenho {lista}.'))).toBe(true)
    // «fazem» não concorda com uma só pessoa («Ana fazem»).
    expect(DIALOGUE_ACTS.informar_quem_faz.some((t) => /\bfazem\b/.test(t))).toBe(false)
    for (const t of renderEveryVariant('informar_quem_faz', { pessoas: 'Ana' })) expect(t).not.toMatch(/Ana fazem/)
    // A persona pode ser masculina (DEC-089): nenhuma abertura fixa «a assistente».
    for (const t of DIALOGUE_ACTS.abrir) expect(t).not.toMatch(/\bSou a assistente\b/)
    // «Combinado» lê-se como confirmação de horário.
    for (const t of DIALOGUE_ACTS.acolher_adiamento) expect(t).not.toMatch(/Combinado/)
    // Sem imperativo seco nas perguntas das variantes.
    for (const t of DIALOGUE_ACTS.perguntar_variantes) expect(t).not.toMatch(/^Me diga/)
  })

  it('o documento de copy tem todas as redações do código (sem deriva)', () => {
    const doc = readFileSync(new URL('../../../docs/product/copy-dialogo-atos.md', import.meta.url), 'utf8')
    for (const act of ALL_ACTS) {
      expect(doc, `ato ${act} em falta no documento`).toContain(`### ${act}\n`)
      for (const t of DIALOGUE_ACTS[act]) {
        expect(doc, `${act}: «${t}» em falta no documento`).toContain(`\`${t.replace('{nome}', '{, nome}').replace(/\n/g, '\\n')}\``)
      }
    }
  })

  it('fallback DEC-107 permanece o texto confirmado', () => {
    expect(MODEL_FALLBACK_TEXT).toBe(
      'Não consegui entender bem. Pode me dizer de outro jeito, ou prefere falar com a equipe?',
    )
  })
})
