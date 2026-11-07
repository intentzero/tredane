/**
 * Família FL- — caminho principal vigente: hub + WhatsApp Flow (DEC-138, ADR-0016).
 * Metodologia de avaliação §9 passo 2 (lacuna G-02). Os casos ligam `flow: true`
 * e percorrem o endpoint real com o cliente Flow simulado (`flow-driver.ts`).
 *
 * Relógio por defeito: qui 05/11/2026 10:00 America/Sao_Paulo (clínica aberta 09:00–18:00).
 */
import { listServices, replaceServiceZonesOp, setServiceActiveOp, upsertServiceOp } from '../../../config'
import { getScheduleSession } from '../../schedule-session'
import type { DialogCase } from './runner'

const ZONAS_FEM = { serviceKey: 'depilacao' as const, line: 'feminino' as const, zones: ['Axila', 'Pernas'] }
const HUB_OPENING = /Hoje funcionamos das 09:00 às 18:00/
const NO_LEAK = [/America\/|Sao_Paulo|São Paulo \(/, /maps\.google|goo\.gl/i, /\{|\}|\[Flow\]/]

export const FL_DIALOG_CASES: DialogCase[] = [
  {
    id: 'FL-01',
    title: 'Hub: «Oi» abre com o expediente de hoje e o CTA do Flow',
    turnosIdeais: 1,
    flow: true,
    turns: [{ role: 'client', text: 'Oi' }],
    expect: {
      flowOffers: 1,
      proposal: false,
      notPaused: true,
      outboundCount: 1,
      outboundExcludes: [...NO_LEAK, /Falar com a equipe/],
      turns: [{ turn: 0, matches: [HUB_OPENING, /O que você precisa\?/] }],
    },
  },
  {
    id: 'FL-02',
    title: 'Flow de ponta a ponta: zonas com linha → proposta → Confirmar marca',
    turnosIdeais: 3,
    flow: true,
    damage: { serviceKey: 'depilacao', zoneNames: ['Axila', 'Pernas'] },
    turns: [
      { role: 'client', text: 'Oi' },
      { role: 'flow', path: { ...ZONAS_FEM, slot: 'first' } },
      { role: 'proposal_sent' },
      { role: 'confirm_proposal' },
    ],
    expect: {
      flowOffers: 1,
      flowRuns: [
        {
          screens: ['HUB', 'SERVICO', 'GENERO', 'VARIANTES', 'HORARIO', 'SUCCESS'],
          outcome: 'nfm_delivered',
          nfmOutcome: 'proposal_sent',
        },
      ],
      proposal: true,
      proposalZones: ['Axila', 'Pernas'],
      // Só o Confirmar cria o compromisso, e cria exactamente um.
      appointments: 1,
      outboundExcludes: NO_LEAK,
      turns: [{ turn: 1, matches: [/Confirmar|Proposta/i] }],
    },
  },
  {
    id: 'FL-03',
    title: 'Serviço sem zonas salta GENERO e VARIANTES; proposta na hora escolhida',
    turnosIdeais: 2,
    flow: true,
    damage: { serviceKey: 'massagem', date: '2026-11-06', time: '10:00' },
    turns: [
      { role: 'client', text: 'Oi' },
      { role: 'flow', path: { serviceKey: 'massagem', slot: '2026-11-06T10:00' } },
    ],
    expect: {
      flowRuns: [
        { screens: ['HUB', 'SERVICO', 'HORARIO', 'SUCCESS'], outcome: 'nfm_delivered', nfmOutcome: 'proposal_sent' },
      ],
      proposal: true,
      proposalAt: { date: '2026-11-06', time: '10:00' },
      noAppointment: true,
    },
  },
  {
    id: 'FL-04',
    title: 'Fechar o Flow e escrever «sim» não marca (DEC-061)',
    turnosIdeais: 3,
    flow: true,
    turns: [
      { role: 'client', text: 'Oi' },
      { role: 'flow', path: { ...ZONAS_FEM, slot: 'first' } },
      { role: 'proposal_sent' },
      { role: 'client', text: 'sim' },
    ],
    expect: { proposal: true, noAppointment: true, outboundExcludes: NO_LEAK },
  },
  {
    id: 'FL-05',
    title: 'Segundo fecho com o mesmo token não repropõe nem duplica',
    turnosIdeais: 2,
    flow: true,
    turns: [
      { role: 'client', text: 'Oi' },
      { role: 'flow', path: { ...ZONAS_FEM, slot: 'first' } },
      { role: 'flow_again' },
    ],
    expect: {
      flowRuns: [{ outcome: 'nfm_delivered', nfmOutcome: 'proposal_sent' }, { outcome: 'token_rejected' }],
      openProposals: 1,
      noAppointment: true,
      turns: [{ turn: 2, excludes: [/./] }],
    },
  },
  {
    id: 'FL-06',
    title: 'Abandonar o Flow não gera mensagem; novo «Oi» volta a abrir o hub',
    turnosIdeais: 2,
    flow: true,
    turns: [
      { role: 'client', text: 'Oi' },
      { role: 'flow', path: { ...ZONAS_FEM, abandonAt: 'HORARIO' } },
      { role: 'clock', setMs: Date.UTC(2026, 10, 5, 14, 0) },
      { role: 'client', text: 'oi' },
    ],
    expect: {
      flowOffers: 2,
      flowRuns: [{ screens: ['HUB', 'SERVICO', 'GENERO', 'VARIANTES', 'HORARIO'], outcome: 'abandoned' }],
      proposal: false,
      noAppointment: true,
      turns: [
        { turn: 1, excludes: [/./] },
        { turn: 2, matches: [HUB_OPENING] },
      ],
    },
  },
  {
    id: 'FL-07',
    title: 'Hub «Meus agendamentos» sem compromisso: frase, sem handoff',
    turnosIdeais: 2,
    flow: true,
    turns: [
      { role: 'client', text: 'Oi' },
      { role: 'flow', path: { hub: 'meus' } },
    ],
    expect: {
      flowRuns: [{ screens: ['HUB', 'SUCCESS'], outcome: 'nfm_delivered', nfmOutcome: 'hub_meus_sent' }],
      notPaused: true,
      proposal: false,
      turns: [{ turn: 1, matches: [/não tem horário marcado/i] }],
    },
  },
  {
    id: 'FL-08',
    title: 'Hub «Falar com a equipe»: pausa a IA com a frase fixa (DEC-083)',
    turnosIdeais: 2,
    flow: true,
    turns: [
      { role: 'client', text: 'Oi' },
      { role: 'flow', path: { hub: 'equipe' } },
    ],
    expect: {
      flowRuns: [{ outcome: 'nfm_delivered', nfmOutcome: 'hub_handoff' }],
      paused: true,
      proposal: false,
      noAppointment: true,
    },
  },
  {
    id: 'FL-09',
    title: 'Hub «Cancelar» sem compromisso: handoff, nada marcado nem cancelado',
    turnosIdeais: 2,
    flow: true,
    turns: [
      { role: 'client', text: 'Oi' },
      { role: 'flow', path: { hub: 'cancelar' } },
    ],
    expect: {
      flowRuns: [{ outcome: 'nfm_delivered', nfmOutcome: 'hub_handoff' }],
      paused: true,
      noAppointment: true,
    },
  },
  {
    id: 'FL-10',
    title: 'Hub «Informações»: expediente sem fuso nem link inventado',
    turnosIdeais: 2,
    flow: true,
    turns: [
      { role: 'client', text: 'Oi' },
      { role: 'flow', path: { hub: 'informacoes' } },
    ],
    expect: {
      flowRuns: [{ outcome: 'nfm_delivered', nfmOutcome: 'hub_info_sent' }],
      notPaused: true,
      outboundExcludes: NO_LEAK,
      turns: [{ turn: 1, matches: [/09:00/] }],
    },
  },
  {
    id: 'FL-11',
    title: 'Hub fora do expediente (21:09): mesmo horário de hoje, sem frase de fechado',
    turnosIdeais: 1,
    flow: true,
    nowMs: Date.UTC(2026, 10, 6, 0, 9),
    turns: [{ role: 'client', text: 'Oi' }],
    expect: {
      flowOffers: 1,
      outboundExcludes: [/fechad[oa]s?/i, ...NO_LEAK],
      turns: [{ turn: 0, matches: [HUB_OPENING] }],
    },
  },
  {
    id: 'FL-12',
    title: 'Pedido com zona («quero depilar a axila») pergunta a linha, sem o CTA do hub',
    turnosIdeais: 1,
    flow: true,
    // CF-36 (#565): o gate do hub reconhece o serviço pela zona.
    // Paulo, 07/11/2026: a pergunta do funil sai sem o botão «Abrir opções».
    // O Flow continua a abrir no «Oi» (FL-01); daqui a cliente responde no chat.
    turns: [{ role: 'client', text: 'quero depilar a axila' }],
    expect: {
      flowOffers: 0,
      proposal: false,
      notPaused: true,
      turns: [{ turn: 0, matches: [/feminina ou masculina/i], excludes: [HUB_OPENING, /O que você precisa\?/, /juntar masculino e feminino/i] }],
    },
  },
  {
    id: 'FL-13',
    title: 'Depois de marcar, «Oi» + hub «Remarcar» inicia a remarcação',
    turnosIdeais: 4,
    flow: true,
    turns: [
      { role: 'client', text: 'Oi' },
      // Amanhã: o compromisso tem de continuar futuro quando o relógio avança.
      { role: 'flow', path: { ...ZONAS_FEM, slot: '2026-11-06T10:00' } },
      { role: 'proposal_sent' },
      { role: 'confirm_proposal' },
      { role: 'clock', setMs: Date.UTC(2026, 10, 5, 15, 0) },
      { role: 'client', text: 'Oi' },
      { role: 'flow', path: { hub: 'remarcar' } },
    ],
    expect: {
      flowOffers: 2,
      flowRuns: [
        { outcome: 'nfm_delivered', nfmOutcome: 'proposal_sent' },
        { outcome: 'nfm_delivered', nfmOutcome: 'hub_reschedule_started' },
      ],
      outboundExcludes: NO_LEAK,
      // Remarcar começa por perguntar o dia; o compromisso original continua (só o Confirmar troca).
      turns: [{ turn: 4, matches: [/dia/i] }],
    },
  },
  {
    id: 'FL-14',
    title: 'Token expirado: o Flow não abre e nada é gravado',
    turnosIdeais: 1,
    flow: true,
    turns: [
      { role: 'client', text: 'Oi' },
      { role: 'flow', path: { ...ZONAS_FEM, slot: 'first', abandonAt: 'never', delayMs: 3 * 24 * 60 * 60_000 } },
    ],
    expect: {
      flowRuns: [{ outcome: 'token_rejected' }],
      proposal: false,
      noAppointment: true,
    },
  },
  {
    id: 'FL-15',
    title: '«Quero depilação» (nome exacto) pergunta a linha, sem o CTA do hub',
    turnosIdeais: 1,
    flow: true,
    turns: [{ role: 'client', text: 'Quero depilação' }],
    expect: {
      flowOffers: 0,
      proposal: false,
      notPaused: true,
      turns: [{ turn: 0, matches: [/feminina ou masculina/i], excludes: [HUB_OPENING] }],
    },
  },
  {
    id: 'FL-16',
    title: '«Quero depilar» com sinónimo na ficha: pergunta a linha, sem o CTA do hub',
    turnosIdeais: 1,
    flow: true,
    prepare: (s) => {
      s.db.run(`UPDATE services SET synonyms_json = ? WHERE id = ?`, JSON.stringify(['depilar']), s.ids.depilacao)
    },
    turns: [{ role: 'client', text: 'Quero depilar' }],
    expect: {
      flowOffers: 0,
      proposal: false,
      notPaused: true,
      turns: [{ turn: 0, matches: [/feminina ou masculina/i], excludes: [HUB_OPENING] }],
    },
  },
  {
    id: 'FL-17',
    title: 'Quadro já preenchido: o eco e o Sim ficam no chat, sem o CTA do hub',
    turnosIdeais: 2,
    flow: true,
    // O salto HUB → SERVICO do routing_model (#587) continua nos testes do endpoint.
    // Aqui o pedido já está no quadro: Sim não marca (DEC-061) e não abre o Flow.
    turns: [
      { role: 'client', text: 'Quero depilação feminina axila e pernas' },
      { role: 'client', text: 'sim' },
    ],
    expect: {
      flowOffers: 0,
      proposal: false,
      noAppointment: true,
      notPaused: true,
      outboundExcludes: NO_LEAK,
      turns: [
        { turn: 0, matches: [/Entendi:/i, /Axila/i, /Pernas/i], excludes: [HUB_OPENING] },
        { turn: 1, excludes: [HUB_OPENING, /O que você precisa\?/] },
      ],
    },
  },
  {
    id: 'FL-18',
    title: 'Catálogo muda com o Flow aberto: fecha para o chat com a frase de recurso, sem proposta',
    turnosIdeais: 2,
    flow: true,
    // ADR-0016 §7 / #587: com o catálogo alterado a meio, o Flow fecha com
    // fallback_reason=catalog_changed e o chat pede o pedido por texto (C12), sem «Ocorreu um erro».
    // Cobre o resultado, não o mecanismo: a verificação da aresta do routing_model (#587) é uma
    // segunda rede que este cenário não alcança (o catálogo mudado já fecha antes) e continua
    // só nos testes unitários do endpoint.
    turns: [
      { role: 'client', text: 'Oi' },
      {
        role: 'flow',
        path: {
          ...ZONAS_FEM,
          slot: 'first',
          mutateBefore: {
            screen: 'VARIANTES',
            run: (s) => setServiceActiveOp(s.db, s.caller, s.ids.depilacao, false, s.clock),
          },
        },
      },
    ],
    expect: {
      flowRuns: [
        {
          screens: ['HUB', 'SERVICO', 'GENERO', 'VARIANTES', 'SUCCESS'],
          outcome: 'nfm_delivered',
          nfmOutcome: 'chat_fallback_sent',
        },
      ],
      proposal: false,
      noAppointment: true,
      outboundExcludes: NO_LEAK,
      turns: [{ turn: 1, matches: [/Não consegui abrir a escolha/] }],
    },
  },
  {
    id: 'FL-19',
    title: 'Massagem aberta: a pergunta dos tipos sai sem o CTA «Abrir opções»',
    turnosIdeais: 1,
    flow: true,
    // Paulo, 07/11/2026. O hub permanece (FL-01). Com o serviço no quadro, a
    // frase do passo não leva o botão. Nome do serviço ≠ variante (#597).
    prepare: (s) => {
      const massagem = listServices(s.db, s.tenantId).find((row) => row.name === 'Massagem')
      if (!massagem) throw new Error('FL-19: serviço Massagem ausente')
      upsertServiceOp(
        s.db,
        s.caller,
        {
          id: massagem.id,
          name: massagem.name,
          durationMinutes: massagem.durationMinutes,
          bufferMinutes: massagem.bufferMinutes,
          priceCents: massagem.priceCents,
          professionalIds: massagem.professionalIds,
          roomRequirement: massagem.roomRequirement,
          variantKind: 'tipo',
          variantKindPlural: 'tipos',
        },
        s.clock,
      )
      replaceServiceZonesOp(
        s.db,
        s.caller,
        massagem.id,
        [
          { name: 'Liberação miofascial', audience: 'ambos', durationMinutes: 50, priceCents: 15_000 },
          { name: 'Ventosaterapia', audience: 'ambos', durationMinutes: 45, priceCents: 14_000 },
          { name: 'Drenagem linfática', audience: 'ambos', durationMinutes: 50, priceCents: 16_000 },
          { name: 'Massagem relaxante', audience: 'ambos', durationMinutes: 50, priceCents: 15_000 },
        ],
        s.clock,
      )
    },
    turns: [{ role: 'client', text: 'queria agendar uma massagem' }],
    expect: {
      flowOffers: 0,
      proposal: false,
      notPaused: true,
      turns: [
        {
          turn: 0,
          matches: [/tipos?/i, /Liberação miofascial/i],
          excludes: [HUB_OPENING, /Não encontrei/i, /O que você precisa\?/],
        },
      ],
    },
  },
  {
    id: 'FL-20',
    title: '«Oi tudo bem?» não escolhe todas as variantes da Massagem',
    turnosIdeais: 2,
    flow: true,
    // Cumprimento («tudo bem») não é o atalho do catálogo. O pedido seguinte
    // pergunta o tipo. Sem eco «Entendi:» do conjunto e sem «Abrir opções» (DEC-144).
    prepare: (s) => {
      const massagem = listServices(s.db, s.tenantId).find((row) => row.name === 'Massagem')
      if (!massagem) throw new Error('FL-20: serviço Massagem ausente')
      upsertServiceOp(
        s.db,
        s.caller,
        {
          id: massagem.id,
          name: massagem.name,
          durationMinutes: massagem.durationMinutes,
          bufferMinutes: massagem.bufferMinutes,
          priceCents: massagem.priceCents,
          professionalIds: massagem.professionalIds,
          roomRequirement: massagem.roomRequirement,
          variantKind: 'tipo',
          variantKindPlural: 'tipos',
        },
        s.clock,
      )
      replaceServiceZonesOp(
        s.db,
        s.caller,
        massagem.id,
        [
          { name: 'Liberação miofascial', audience: 'ambos', durationMinutes: 50, priceCents: 15_000 },
          { name: 'Ventosaterapia', audience: 'ambos', durationMinutes: 45, priceCents: 14_000 },
          { name: 'Drenagem linfática', audience: 'ambos', durationMinutes: 50, priceCents: 16_000 },
          { name: 'Massagem relaxante', audience: 'ambos', durationMinutes: 50, priceCents: 15_000 },
        ],
        s.clock,
      )
    },
    turns: [
      { role: 'client', text: 'Oi tudo bem?' },
      { role: 'client', text: 'Quero agendar uma massagem' },
      {
        role: 'owner',
        note: 'sessão sem variante fechada (o cumprimento não escolheu o catálogo)',
        act: (s) => {
          const session = getScheduleSession(s.db, s.tenantId, s.conversationId)
          if (session?.variantIds && session.variantIds.length > 0) {
            throw new Error(
              `FL-20: variantIds inesperados ${JSON.stringify(session.variantIds)} — cumprimento não escolhe variantes`,
            )
          }
        },
      },
    ],
    expect: {
      flowOffers: 1,
      proposal: false,
      notPaused: true,
      noAppointment: true,
      turns: [
        { turn: 0, matches: [HUB_OPENING, /O que você precisa\?/] },
        {
          turn: 1,
          matches: [/tipos?/i, /Liberação miofascial/i, /Ventosaterapia/i, /Drenagem linfática/i, /Massagem relaxante/i],
          excludes: [/Entendi:/i, HUB_OPENING, /O que você precisa\?/, /Não encontrei/i, /Abrir opções/],
        },
      ],
    },
  },
]
