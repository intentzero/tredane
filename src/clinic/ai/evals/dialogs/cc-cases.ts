/**
 * Família CC- — consulta de catálogo (DEC-142, Paulo, 06/11/2026) e Confirmar suspenso.
 * Metodologia de avaliação §9 (revisão 0.6): as mudanças de 06/11 entraram só com testes
 * unitários; estes diálogos fixam o comportamento no L1 e as invariantes que dependem dele.
 *
 * Relógio por defeito: qui 05/11/2026 10:00 America/Sao_Paulo. Catálogo de referência:
 * todos os serviços com audiência «qualquer», salvo o que o caso mudar em `prepare`.
 */
import { listServices, listZones, replaceServiceZonesOp, upsertServiceOp } from '../../../config'
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
    id: 'A-32',
    title: 'D3: «não quero pernas, só axila» — a negação não reentra; eco só Axila',
    turnosIdeais: 2,
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
      { role: 'client', text: 'Na verdade não quero pernas, só axila' },
    ],
    expect: {
      noAppointment: true,
      turns: [
        { turn: 1, matches: [/Entendi: Axila\. Certo\?/] },
        { turn: 1, excludes: [/Pernas/i] },
      ],
    },
  },
  {
    id: 'A-33',
    title:
      'D3: após Todas, «Sem orelha» remove Orelha do eco (não substitui por só Orelha)',
    turnosIdeais: 2,
    // Staging Paulo 08/11/2026: eco de Todas → «Sem orelha» tratava Orelha como select positivo.
    prepare: (s) => {
      const prior = listZones(s.db, s.tenantId, s.ids.depilacao)
      replaceServiceZonesOp(
        s.db,
        s.caller,
        s.ids.depilacao,
        [
          ...prior.map((z) => ({
            id: z.id,
            name: z.name,
            audience: z.audience,
            durationMinutes: z.durationMinutes,
            priceCents: z.priceCents,
            active: z.active,
            synonyms: z.synonyms,
          })),
          { name: 'Orelha', audience: 'feminino', durationMinutes: 10, priceCents: 3000 },
        ],
        s.clock,
      )
      saveScheduleSession(
        s.db,
        s.tenantId,
        s.conversationId,
        { serviceId: s.ids.depilacao, audienceLine: 'feminino', phase: 'coletando' },
        s.clock,
      )
    },
    turns: [
      { role: 'client', text: 'Todas' },
      { role: 'client', text: 'Sem orelha' },
    ],
    expect: {
      proposal: false,
      noAppointment: true,
      turns: [
        {
          turn: 0,
          matches: [/Entendi:.*Orelha.*Certo\?/],
        },
        {
          turn: 1,
          matches: [/Entendi:.*Axila.*Pernas.*Certo\?/],
          excludes: [/Orelha/i],
        },
      ],
    },
  },
  {
    id: 'CC-07',
    title: 'D4: «Quanto custa pernas?» responde preço e não selecciona no funil seguinte',
    turnosIdeais: 2,
    prepare: (s) =>
      saveScheduleSession(
        s.db,
        s.tenantId,
        s.conversationId,
        { serviceId: s.ids.depilacao, audienceLine: 'feminino', phase: 'coletando' },
        s.clock,
      ),
    turns: [
      { role: 'client', text: 'Quanto custa pernas?' },
      { role: 'client', text: 'Quero marcar axila sexta às 10h' },
    ],
    expect: {
      noAppointment: true,
      outboundIncludes: ['R$'],
      // Segundo turno marca só Axila (eco ou Horários) — Pernas da consulta não ficou no quadro.
      turns: [
        { turn: 0, matches: [/R\$|custa/i] },
        { turn: 1, excludes: [/Entendi:.*Pernas/i] },
      ],
    },
  },
  {
    id: 'CC-08',
    title:
      'D4 bridge + dia: preço Liberação → «Quero» → «próxima quarta disponível?» sem Não encontrei',
    turnosIdeais: 3,
    // Staging Paulo 08/11/2026: (1) cotação não grava (D4); «Quero» afirma.
    // (2) «disponível» não é sobra de zona — mantém Liberação e oferece quarta.
    prepare: (s) => {
      const massagem = listServices(s.db, s.tenantId).find((row) => row.name === 'Massagem')
      if (!massagem) throw new Error('CC-08: serviço Massagem ausente no cenário')
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
          variantSelection: 'uma',
        },
        s.clock,
      )
      replaceServiceZonesOp(
        s.db,
        s.caller,
        massagem.id,
        [
          { name: 'Liberação miofascial', audience: 'ambos', durationMinutes: 60, priceCents: 20_000 },
          { name: 'Ventosaterapia', audience: 'ambos', durationMinutes: 45, priceCents: 14_000 },
          { name: 'Drenagem linfática', audience: 'ambos', durationMinutes: 50, priceCents: 16_000 },
          { name: 'Massagem relaxante', audience: 'ambos', durationMinutes: 50, priceCents: 15_000 },
        ],
        s.clock,
      )
      saveScheduleSession(
        s.db,
        s.tenantId,
        s.conversationId,
        { serviceId: massagem.id, phase: 'coletando' },
        s.clock,
      )
    },
    turns: [
      { role: 'client', text: 'Quanto custa a liberação miofascial?' },
      { role: 'client', text: 'Quero' },
      { role: 'client', text: 'Na próxima quarta tem horário disponível?' },
    ],
    expect: {
      proposal: false,
      notPaused: true,
      noAppointment: true,
      outboundIncludes: ['R$'],
      turns: [
        { turn: 0, matches: [/R\$|custa/i, /Liberação miofascial/i] },
        {
          turn: 1,
          matches: [/\d{1,2}:\d{2}/],
          excludes: [/\bqual tipo\b/i, /\bquais tipos?\b/i, /Para Massagem/i],
        },
        {
          turn: 2,
          // Paulo 08/11/2026: dia já pedido → «disponíveis para quarta», não «próximos…».
          matches: [/horários disponíveis para quarta\s+11\/11/i, /\d{1,2}:\d{2}/],
          excludes: [
            /Não encontrei/i,
            /dispon[ií]vel nas opções/i,
            /próximos horários/i,
            /\bqual tipo\b/i,
            /Quer Liberação miofascial/i,
          ],
        },
      ],
    },
  },
  {
    id: 'CC-09',
    title: 'A meio de «Quais zonas?», «Quanto custa?» devolve tabela de preços',
    turnosIdeais: 1,
    // Staging Paulo 08/11/2026: serviço+linha já abertos; bare price ask não re-pergunta só nomes.
    prepare: (s) =>
      saveScheduleSession(
        s.db,
        s.tenantId,
        s.conversationId,
        { serviceId: s.ids.depilacao, audienceLine: 'feminino', phase: 'coletando' },
        s.clock,
      ),
    turns: [{ role: 'client', text: 'Quanto custa?' }],
    expect: {
      proposal: false,
      noAppointment: true,
      outboundIncludes: ['R$'],
      turns: [
        {
          turn: 0,
          matches: [
            /Axila — R\$\s*40,00 \(15 min\)/,
            /Pernas — R\$\s*120,00 \(30 min\)/,
            /Buço — R\$\s*25,00 \(10 min\)/,
            /quais zonas/i,
          ],
          excludes: [/^Quais zonas\?/i, /Temos Axila, Pernas/i],
        },
      ],
    },
  },
  {
    id: 'CC-10',
    title: 'A meio do ask-tipo, «Qual o valor das massagens?» devolve tabela e reabre o tipo',
    turnosIdeais: 1,
    // Staging Paulo 08/11/2026: Massagem modo uma; pesquisa de preço não perde o funil.
    prepare: (s) => {
      const massagem = listServices(s.db, s.tenantId).find((row) => row.name === 'Massagem')
      if (!massagem) throw new Error('CC-10: serviço Massagem ausente no cenário')
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
          variantSelection: 'uma',
        },
        s.clock,
      )
      replaceServiceZonesOp(
        s.db,
        s.caller,
        massagem.id,
        [
          { name: 'Liberação miofascial', audience: 'ambos', durationMinutes: 60, priceCents: 20_000 },
          { name: 'Ventosaterapia', audience: 'ambos', durationMinutes: 45, priceCents: 14_000 },
          { name: 'Drenagem linfática', audience: 'ambos', durationMinutes: 50, priceCents: 16_000 },
          { name: 'Massagem relaxante', audience: 'ambos', durationMinutes: 50, priceCents: 15_000 },
        ],
        s.clock,
      )
      saveScheduleSession(
        s.db,
        s.tenantId,
        s.conversationId,
        { serviceId: massagem.id, phase: 'coletando' },
        s.clock,
      )
    },
    turns: [{ role: 'client', text: 'Qual o valor das massagens?' }],
    expect: {
      proposal: false,
      noAppointment: true,
      outboundIncludes: ['R$'],
      turns: [
        {
          turn: 0,
          matches: [
            /Liberação miofascial — R\$\s*200,00 \(60 min\)/,
            /Ventosaterapia — R\$\s*140,00 \(45 min\)/,
            /Drenagem linfática — R\$\s*160,00 \(50 min\)/,
            /Massagem relaxante — R\$\s*150,00 \(50 min\)/,
            /qual tipo você quer/i,
          ],
          excludes: [/^Para Massagem, qual tipo/i, /Temos Liberação/i],
        },
      ],
    },
  },
  {
    id: 'CC-11',
    title: 'A meio da oferta de slots, «Qual o valor?» cotiza a variante e mantém o quadro',
    turnosIdeais: 1,
    // Staging Paulo 08/11/2026: após tipo+horários, «Qual o valor?» não reabre ask-tipo.
    prepare: (s) => {
      const massagem = listServices(s.db, s.tenantId).find((row) => row.name === 'Massagem')
      if (!massagem) throw new Error('CC-11: serviço Massagem ausente no cenário')
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
          variantSelection: 'uma',
        },
        s.clock,
      )
      const zones = replaceServiceZonesOp(
        s.db,
        s.caller,
        massagem.id,
        [
          { name: 'Liberação miofascial', audience: 'ambos', durationMinutes: 60, priceCents: 20_000 },
          { name: 'Massagem relaxante', audience: 'ambos', durationMinutes: 50, priceCents: 15_000 },
        ],
        s.clock,
      )
      const relaxante = zones.find((z) => z.name === 'Massagem relaxante')
      if (!relaxante) throw new Error('CC-11: Massagem relaxante ausente')
      saveScheduleSession(
        s.db,
        s.tenantId,
        s.conversationId,
        {
          serviceId: massagem.id,
          variantIds: [relaxante.id],
          phase: 'coletando',
          lastOffer: {
            slots: [
              { startsAt: s.clock.nowMs() + 86_400_000, professionalId: 'pro_x' },
              { startsAt: s.clock.nowMs() + 90_000_000, professionalId: 'pro_x' },
            ],
            messageId: 'msg_cc11_offer',
          },
        },
        s.clock,
      )
    },
    turns: [{ role: 'client', text: 'Qual o valor?' }],
    expect: {
      proposal: false,
      noAppointment: true,
      outboundIncludes: ['R$'],
      turns: [
        {
          turn: 0,
          matches: [
            /Massagem relaxante/i,
            /R\$\s*150,00/,
            /Qual horário fica melhor para Massagem\?|qual horário você prefere/i,
          ],
          excludes: [/\bqual tipo\b/i, /\bquais tipos?\b/i, /Liberação miofascial — R\$/],
        },
      ],
    },
  },
]
