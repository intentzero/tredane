/**
 * Família CC- — consulta de catálogo (DEC-142, Paulo, 06/11/2026) e Confirmar suspenso.
 * Metodologia de avaliação §9 (revisão 0.6): as mudanças de 06/11 entraram só com testes
 * unitários; estes diálogos fixam o comportamento no L1 e as invariantes que dependem dele.
 *
 * Relógio por defeito: qui 05/11/2026 10:00 America/Sao_Paulo. Catálogo de referência:
 * todos os serviços com audiência «qualquer», salvo o que o caso mudar em `prepare`.
 */
import { replaceServiceZonesOp, upsertServiceOp } from '../../../config'
import { saveScheduleSession } from '../../schedule-session'
import type { DialogCase } from './runner'
import type { DialogScenario } from './scenario'

/** Audiência por serviço (chave em `scenario.ids`), directo no cadastro de teste. */
const setAudience =
  (map: Partial<Record<keyof DialogScenario['ids'], 'feminino' | 'masculino' | 'qualquer'>>) =>
  (s: DialogScenario) => {
    for (const [key, audiencia] of Object.entries(map)) {
      s.db.run(
        `UPDATE services SET audiencia = ? WHERE id = ?`,
        audiencia,
        s.ids[key as keyof DialogScenario['ids']],
      )
    }
  }

const ASK_LIST = /Feminino ou masculino\?/
const NO_LEAK = [/maps\.google|goo\.gl/i, /\{|\}/]

export const CC_DIALOG_CASES: DialogCase[] = [
  {
    id: 'CC-01',
    title: 'Sem audiência: «quais serviços você tem?» abre a lista Feminino/Masculino, não o Flow',
    turnosIdeais: 1,
    flow: true,
    turns: [{ role: 'client', text: 'quais serviços você tem?' }],
    expect: {
      // DEC-142: a lista não é escolha do M5 nem é substituída pelo CTA do Flow (DEC-138/140).
      flowOffers: 0,
      proposal: false,
      notPaused: true,
      outboundCount: 1,
      outboundExcludes: NO_LEAK,
      turns: [{ turn: 0, matches: [ASK_LIST] }],
    },
  },
  {
    id: 'CC-02',
    title: '«serviços masculinos» lista só os da audiência masculina ou qualquer',
    turnosIdeais: 1,
    prepare: setAudience({ depilacao: 'feminino', massagem: 'masculino' }),
    turns: [{ role: 'client', text: 'serviços masculinos' }],
    expect: {
      proposal: false,
      notPaused: true,
      outboundCount: 1,
      outboundIncludes: ['Temos:\n', '\nMassagem\n', '\nBronzeamento\n', 'Qual você quer?'],
      outboundExcludes: [/Depilação/, ...NO_LEAK],
    },
  },
  {
    id: 'CC-03',
    title: 'Sem serviço na audiência pedida: frase curta, sem inventar nem cair no modelo',
    turnosIdeais: 1,
    prepare: (s) => s.db.run(`UPDATE services SET audiencia = 'feminino'`),
    turns: [{ role: 'client', text: 'serviços masculinos' }],
    expect: {
      proposal: false,
      notPaused: true,
      outboundCount: 1,
      turns: [{ turn: 0, matches: [/Não tenho serviços no masculino\./], excludes: [/Temos:/] }],
      outboundExcludes: NO_LEAK,
    },
  },
  {
    id: 'CC-04',
    title: '«Quero outro serviço» com proposta aberta retira a proposta; o Confirmar antigo não marca',
    turnosIdeais: 2,
    turns: [
      { role: 'client', text: 'Quero limpeza de pele amanhã às 15h' },
      { role: 'proposal_sent' },
      { role: 'client', text: 'quero outro serviço' },
      { role: 'confirm_proposal' },
    ],
    expect: {
      // INV-01: nenhum compromisso por um Confirmar de proposta retirada.
      appointments: 0,
      openProposals: 0,
      turns: [
        { turn: 1, matches: [ASK_LIST] },
        { turn: 2, matches: [/já não está válida/] },
      ],
    },
  },
  {
    id: 'CC-05',
    title: 'Audiência já conhecida não se repergunta: a meio da marcação diz que continua nela',
    turnosIdeais: 3,
    // CF-45 (corrigido 06/11/2026): a audiência fixada pela consulta («serviços masculinos»)
    // não passava ao funil. `saveBookingFrame` descartava a linha ao escolher o serviço e os
    // leitores só a levavam quando o serviço da sessão coincidia com o do pedido.
    prepare: setAudience({ depilacao: 'feminino', massagem: 'masculino' }),
    turns: [
      { role: 'client', text: 'serviços masculinos' },
      { role: 'client', text: 'Quero limpeza de pele amanhã às 15h' },
      { role: 'client', text: 'quero outro serviço' },
    ],
    expect: {
      openProposals: 0,
      noAppointment: true,
      outboundExcludes: [/Depilação/, ...NO_LEAK],
      turns: [
        { turn: 2, matches: [/Continuo no masculino/, /Temos:/], excludes: [ASK_LIST] },
      ],
    },
  },
  {
    id: 'CC-06',
    title: 'Audiência da consulta segue ao funil: «axila» sai na linha escolhida, sem reperguntar',
    turnosIdeais: 2,
    // CF-45: «Axila» existe nas duas linhas (DEC-079). Com «serviços femininos» já dito,
    // o funil usa a feminina (R$ 40,00, não os R$ 50,00 da masculina) e não repergunta a linha.
    damage: { serviceKey: 'depilacao', zoneNames: ['Axila'] },
    turns: [
      { role: 'client', text: 'serviços femininos' },
      { role: 'client', text: 'Quero depilação axila sexta às 10h' },
    ],
    expect: {
      proposal: true,
      proposalZones: ['Axila'],
      noAppointment: true,
      outboundIncludes: ['R$ 40,00'],
      outboundExcludes: [/R\$ 50,00/, ...NO_LEAK],
      turns: [{ turn: 1, excludes: [/feminina ou masculina|feminino ou masculino/i] }],
    },
  },
  {
    id: 'A-22',
    title: 'Substituição de zonas suspende o Confirmar: o toque no cartão antigo não marca',
    turnosIdeais: 2,
    // Migração 0053 `confirm_suspended` (06/11/2026). Eco «Entendi: … Certo?» (DEC-137).
    prepare: (s) =>
      saveScheduleSession(
        s.db,
        s.tenantId,
        s.conversationId,
        { serviceId: s.ids.depilacao, audienceLine: 'feminino', phase: 'coletando' },
        s.clock,
      ),
    turns: [
      { role: 'client', text: 'Axila e pernas sexta às 10h' },
      { role: 'proposal_sent' },
      { role: 'client', text: 'quero só pernas' },
      { role: 'confirm_proposal' },
    ],
    expect: {
      appointments: 0,
      turns: [{ turn: 1, matches: [/Entendi: Pernas\. Certo\?/] }],
    },
  },
  {
    id: 'A-23',
    title: 'Confirmar suspenso recebe resposta (hoje o toque fica sem resposta)',
    turnosIdeais: 3,
    // CF-44 (Proposto): o executor recusa `confirm_suspended` sem enviar nada (só responde
    // em `expired` e `not_enviada`). A cliente vê o cartão com Confirmar, toca e nada acontece.
    // A frase é copy nova: exige aprovação do Paulo (DEC-104). Este caso passa a verde quando
    // o toque tiver resposta; aí retira-se o `knownFailure`.
    knownFailure: 'CF-44',
    prepare: (s) =>
      saveScheduleSession(
        s.db,
        s.tenantId,
        s.conversationId,
        { serviceId: s.ids.depilacao, audienceLine: 'feminino', phase: 'coletando' },
        s.clock,
      ),
    turns: [
      { role: 'client', text: 'Axila e pernas sexta às 10h' },
      { role: 'proposal_sent' },
      { role: 'client', text: 'quero só pernas' },
      { role: 'confirm_proposal' },
    ],
    expect: {
      appointments: 0,
      turns: [{ turn: 2, matches: [/\S/] }],
    },
  },
  {
    id: 'A-24',
    title: 'Nome do serviço aberto não escolhe variante («massagem» ≠ «Massagem relaxante»)',
    turnosIdeais: 1,
    // Paulo 07/11/2026 / #597: com Massagem aberta e tipos, a frase só nomeia o serviço.
    // Pergunta as variantes (Opções); não «Não encontrei…» e não fecha «Massagem relaxante».
    prepare: (s) => {
      upsertServiceOp(
        s.db,
        s.caller,
        {
          id: s.ids.massagemTipos,
          name: 'Massagem',
          durationMinutes: 50,
          bufferMinutes: 0,
          priceCents: 15000,
          professionalIds: [s.ids.bia],
          roomRequirement: { mode: 'none' },
          variantKind: 'tipo',
          variantKindPlural: 'tipos',
        },
        s.clock,
      )
      replaceServiceZonesOp(
        s.db,
        s.caller,
        s.ids.massagemTipos,
        [
          { name: 'Liberação miofascial', audience: 'ambos', durationMinutes: 50, priceCents: 15000 },
          { name: 'Ventosaterapia', audience: 'ambos', durationMinutes: 50, priceCents: 15000 },
          { name: 'Drenagem linfática', audience: 'ambos', durationMinutes: 50, priceCents: 15000 },
          { name: 'Massagem relaxante', audience: 'ambos', durationMinutes: 50, priceCents: 15000 },
        ],
        s.clock,
      )
      saveScheduleSession(
        s.db,
        s.tenantId,
        s.conversationId,
        { serviceId: s.ids.massagemTipos, phase: 'coletando' },
        s.clock,
      )
    },
    turns: [{ role: 'client', text: 'Bom dia, queria agendar uma massagem' }],
    expect: {
      proposal: false,
      noAppointment: true,
      outboundExcludes: [/Não encontrei/i, ...NO_LEAK],
      turns: [
        {
          turn: 0,
          matches: [/Massagem relaxante/i, /Liberação miofascial|Ventosaterapia|Drenagem/i],
          excludes: [/Não encontrei/i],
        },
      ],
    },
  },
]
