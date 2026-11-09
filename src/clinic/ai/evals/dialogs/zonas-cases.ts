/**
 * Zonas em texto livre e telemetria do funil (DEC-143, 06/11/2026) — metodologia 0.6 (G-09).
 * Entraram na `main` (#589, #588) só com testes unitários; estes diálogos fixam o comportamento.
 * A-38: T2 friction `nao_encontrei` (session-analytics).
 *
 * Relógio por defeito: qui 05/11/2026 10:00 America/Sao_Paulo. Catálogo de referência:
 * Depilação com Axila, Pernas (feminino e masculino, DEC-079) e Buço (ambos).
 */
import { frictionTermHash } from '../../turn-friction'
import type { DialogCase } from './runner'

const NO_LEAK = [/maps\.google|goo\.gl/i, /\{|\}/]
const COTOVELO_HASH = frictionTermHash('cotovelo')!

export const ZONAS_DIALOG_CASES: DialogCase[] = [
  {
    id: 'A-27',
    title: 'Zonas escritas antes da linha não se perdem: a linha vem depois e o eco nomeia as duas',
    turnosIdeais: 3,
    // #589 / DEC-143: a janela do funil começava depois da mensagem de abertura, por isso
    // «feminina» voltava a perguntar as zonas (e a consulta de catálogo respondia com a lista).
    turns: [
      { role: 'client', text: 'Quero depilação de axila e pernas' },
      { role: 'client', text: 'feminina' },
      { role: 'client', text: 'sim' },
    ],
    expect: {
      proposal: false,
      noAppointment: true,
      outboundExcludes: [/quais zonas/i, /Temos:/, ...NO_LEAK],
      turns: [
        { turn: 0, matches: [/feminina ou masculina/i] },
        { turn: 1, matches: [/Entendi: Axila e Pernas\. Certo\?/], excludes: [/quais zonas|Temos Axila/i] },
        // Sim confirma o conjunto e abre os Horários (as redações variam; as horas não);
        // não marca (DEC-061).
        { turn: 2, matches: [/\d{1,2}:\d{2}/] },
      ],
    },
  },
  {
    id: 'A-25',
    title: 'Telemetria: zonas dadas em resposta à pergunta contam como «já pedidas»',
    turnosIdeais: 2,
    // #588 / DEC-143 (medida a): `zonesAskedBefore` separa a resposta à pergunta das zonas
    // das zonas escritas sem pergunta. Só booleanos, sem texto da conversa.
    turns: [
      { role: 'client', text: 'Quero depilação feminina' },
      { role: 'client', text: 'axila e pernas' },
    ],
    expect: {
      proposal: false,
      noAppointment: true,
      turnDecided: [
        { variantsChanged: false, zonesAskedBefore: false },
        { route: 'deterministic_question', variantsChanged: true, zonesAskedBefore: true, modelCalled: false },
      ],
      turns: [{ turn: 1, matches: [/Entendi: Axila e Pernas\. Certo\?/] }],
    },
  },
  {
    id: 'A-26',
    title: 'Telemetria: zonas escritas por iniciativa, com o serviço já no quadro mas as zonas por pedir',
    turnosIdeais: 2,
    // #588 / DEC-143 (medida a): `variantsChanged` sem `zonesAskedBefore` = zonas escritas sem
    // que lhas pedissem. Aqui o quadro já tem o serviço (a linha foi perguntada, as zonas não).
    turns: [
      { role: 'client', text: 'Quero depilação' },
      { role: 'client', text: 'feminina, axila e pernas' },
    ],
    expect: {
      proposal: false,
      noAppointment: true,
      turnDecided: [
        { variantsChanged: false, zonesAskedBefore: false },
        { variantsChanged: true, zonesAskedBefore: false, modelCalled: false },
      ],
      turns: [{ turn: 1, matches: [/Entendi: Axila e Pernas\. Certo\?/] }],
    },
  },
  {
    id: 'A-38',
    title: 'Telemetria T2: «Axila e cotovelo» emite friction nao_encontrei (sem termo em claro)',
    turnosIdeais: 2,
    // session-analytics T2: option-miss (#509 / zone-echo) → friction. Falha sem a flag.
    // «cotovelo» sozinho pode só reperguntar zonas; com Axila parcial dispara Não encontrei.
    turns: [
      { role: 'client', text: 'Quero depilação feminina' },
      { role: 'client', text: 'Axila e cotovelo' },
    ],
    expect: {
      proposal: false,
      noAppointment: true,
      turnDecided: [
        { variantsChanged: false },
        {
          friction: [
            { flag: 'nao_encontrei', kind: 'zone', termHash: COTOVELO_HASH },
          ],
        },
      ],
      turns: [
        {
          turn: 1,
          matches: [/Não encontrei cotovelo nas opções/i],
          excludes: [/Entendi:/i],
        },
      ],
      outboundExcludes: NO_LEAK,
    },
  },
  {
    id: 'A-40',
    title: 'Após «Masculina», uma só ask-tipo de zonas (sem handoff duplicado)',
    turnosIdeais: 2,
    // Staging Paulo 09/11/2026: texto/toque da linha fazia sair a mesma frase duas vezes
    // (handoff + Opções). Catálogo cede ao autoBook; interactive reply não reentra no autodraft.
    // Paulo 09/11 (mais tarde): `varias` = texto livre, sem lista Opções.
    turns: [
      { role: 'client', text: 'Quero depilação' },
      { role: 'client', text: 'Masculina' },
    ],
    expect: {
      proposal: false,
      noAppointment: true,
      outboundCount: 2,
      turns: [
        { turn: 0, matches: [/feminina ou masculina/i] },
        {
          turn: 1,
          matches: [/quais zonas/i, /Escreva uma ou várias/i],
          excludes: [/Falar com a equipe/i, /Em Opções/i],
        },
      ],
      outboundExcludes: NO_LEAK,
    },
  },
  {
    id: 'A-41',
    title: 'Sim do eco abre uma só oferta de Horários (DEC-137)',
    turnosIdeais: 3,
    // Staging Paulo ~12:20 SP 09/11/2026: toque Sim → duas ofertas Horários iguais
    // (race ingest autodraft + choice). Skip interactive_reply_button (#640) +
    // cobertura explícita: texto Sim também uma só.
    turns: [
      { role: 'client', text: 'Quero depilação feminina' },
      { role: 'client', text: 'axila e pernas' },
      { role: 'client', text: 'Sim' },
    ],
    expect: {
      proposal: false,
      noAppointment: true,
      outboundCount: 3,
      turns: [
        { turn: 0, matches: [/quais zonas/i] },
        { turn: 1, matches: [/Entendi: Axila e Pernas\. Certo\?/] },
        {
          turn: 2,
          matches: [/\d{1,2}:\d{2}/],
          excludes: [/Entendi:/i, /quais zonas/i],
        },
      ],
      outboundExcludes: NO_LEAK,
    },
  },
]
