/**
 * #414 M4: atos de diálogo — hash estável, INV-05 e forma.
 * Dados fictícios. Frases ainda Propostas (ok Paulo).
 */
import { describe, expect, it } from 'vitest'
import {
  DIALOGUE_ACTS,
  dialogueActIndex,
  renderDialogueAct,
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

  it('todas as redações preenchidas passam INV-05 (J-09)', () => {
    const samples: Array<[DialogueActId, Record<string, string>]> = [
      ['abrir', { nome: 'Ana' }],
      ['perguntar_linha', { serviço: 'Depilação' }],
      ['perguntar_variantes', { serviço: 'Depilação', tipo: 'zonas', lista: 'Axila, Pernas, Buço' }],
      ['oferecer_horarios', { assunto: 'Limpeza de pele', quando: 'amanhã ', lista: '09:00, 10:00, 14:00' }],
      [
        'sem_vaga_alternativas',
        { hora: '16:00', lista: '15:00, 14:30 ou amanhã às 10:00' },
      ],
      ['informar_preco', { preço: 'R$ 180,00', duração: '60' }],
      ['informar_preco_sem_cadastro', {}],
      ['informar_duracao', { duração: '60' }],
      ['informar_expediente', { lista: 'Seg–Sex 09:00–18:00' }],
      ['informar_local', { endereço: 'Rua Fictícia, 10' }],
      ['informar_quem_faz', { pessoas: 'Gi e Ana' }],
      ['informar_explicacao', { explicação: 'A limpeza remove impurezas da pele.' }],
      ['acolher_adiamento', {}],
      ['esclarecer', {}],
    ]
    for (const [act, vars] of samples) {
      // Força todas as variantes de índice via ids distintos.
      for (let i = 0; i < DIALOGUE_ACTS[act].length; i++) {
        const text = renderDialogueAct(act, `cnv_scan_${act}_${i}`, vars)
        expect(forbiddenClientTermsIn(text), `${act}: ${text}`).toEqual([])
        expect(text.length).toBeGreaterThan(0)
        expect(text.length).toBeLessThanOrEqual(1000)
      }
    }
  })

  it('fallback DEC-107 permanece o texto confirmado', () => {
    expect(MODEL_FALLBACK_TEXT).toBe(
      'Não consegui entender bem. Pode me dizer de outro jeito, ou prefere falar com a equipe?',
    )
  })
})
