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
      turns: [{ turn: 1, matches: [/Entendi: pernas\. Certo\?/] }],
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
        { turn: 1, matches: [/Entendi: axila\. Certo\?/] },
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
          matches: [/Entendi:.*orelha.*Certo\?/],
        },
        {
          turn: 1,
          matches: [/Entendi:.*axila.*pernas.*Certo\?/],
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
            /Toque em Opções|Escreva uma ou várias/i,
          ],
          excludes: [/^Quais zonas\?/i, /Temos Axila, Pernas/i, /Pode ser mais de uma/i],
        },
      ],
    },
  },
  {
    id: 'CC-10',
    title: 'A meio do ask-tipo, «Qual o valor das massagens?» devolve tabela e reabre o tipo',
    turnosIdeais: 1,
    // Staging Paulo 08/11/2026: Massagem modo uma; pesquisa de preço não perde o funil.
    // P1 stack: ask_info mid-funnel park→realize→resume (gate; não limpa pending).
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
    id: 'CC-13',
    title: 'Oferta com dia «amanhã» diz «amanhã», não weekday+DD/MM',
    turnosIdeais: 1,
    // Preferência Paulo 09/11/2026: dia civil amanhã → rótulo «amanhã» (relógio da clínica).
    // Relógio do harness: qui 05/11 → amanhã = sexta 06/11.
    // CC-12 já é a lista «Temos:» após Feminino/Masculino (#645).
    prepare: (s) => {
      const massagem = listServices(s.db, s.tenantId).find((row) => row.name === 'Massagem')
      if (!massagem) throw new Error('CC-13: serviço Massagem ausente no cenário')
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
        [{ name: 'Massagem relaxante', audience: 'ambos', durationMinutes: 50, priceCents: 15_000 }],
        s.clock,
      )
      const relaxante = zones[0]
      if (!relaxante) throw new Error('CC-13: Massagem relaxante ausente')
      saveScheduleSession(
        s.db,
        s.tenantId,
        s.conversationId,
        {
          serviceId: massagem.id,
          variantIds: [relaxante.id],
          phase: 'coletando',
        },
        s.clock,
      )
    },
    turns: [{ role: 'client', text: 'Tem horário amanhã?' }],
    expect: {
      proposal: false,
      noAppointment: true,
      turns: [
        {
          turn: 0,
          // Sem \\b no fim: «ã» não é word-char ASCII e \\b falha após amanhã.
          matches: [/disponíveis para amanhã/i, /\d{1,2}:\d{2}/],
          excludes: [/sexta\s+06\/11/i, /\b06\/11\b/, /próximos horários/i],
        },
      ],
    },
  },
  {
    id: 'CC-11',
    title: 'A meio da oferta de slots, «Qual o valor?» cotiza a variante e mantém o quadro',
    turnosIdeais: 1,
    // Staging Paulo 08/11/2026: após tipo+horários, «Qual o valor?» não reabre ask-tipo.
    // P1 stack + rsamp_fa7f138: após preço, reoferta slots (não só perguntar_horario).
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
            /\d{1,2}:\d{2}/,
            /horários|próximos horários|tenho/i,
          ],
          excludes: [/\bqual tipo\b/i, /\bquais tipos?\b/i, /Liberação miofascial — R\$/],
        },
      ],
    },
  },
  {
    id: 'CC-12',
    title: 'Após Feminino/Masculino da consulta, uma só lista «Temos:» (DEC-142)',
    turnosIdeais: 2,
    // Staging Paulo ~13:42 SP 09/11/2026: toque Masculino na Escolher → duas
    // listas «Temos:» iguais (race ingest autodraft + handleCatalogAudienceClick).
    // Skip interactive_reply_button (#640) + lock L1 no texto livre da linha.
    prepare: setAudience({ depilacao: 'feminino', massagem: 'masculino' }),
    turns: [
      { role: 'client', text: 'quais serviços você tem?' },
      { role: 'client', text: 'Masculino' },
    ],
    expect: {
      proposal: false,
      noAppointment: true,
      outboundCount: 2,
      turns: [
        { turn: 0, matches: [ASK_LIST] },
        {
          turn: 1,
          matches: [/Temos:/, /Massagem/, /Bronzeamento/, /Qual você quer\?/],
          excludes: [/Depilação/, ASK_LIST],
        },
      ],
      outboundExcludes: NO_LEAK,
    },
  },
  {
    id: 'CC-14',
    title:
      'B2: «quero outro agendamento» mid-funnel limpa frame e abre catálogo (não «Não encontrei agendamento»)',
    turnosIdeais: 1,
    // Paulo 09/11/2026 Confirmado: B2 = DEC-142; antes do match de zona.
    prepare: (s) => {
      const zones = s.db.all<{ id: string; name: string; audience: string }>(
        `SELECT id, name, audience FROM service_zones WHERE tenant_id = ? AND service_id = ?`,
        s.tenantId,
        s.ids.depilacao,
      )
      const variantIds = zones
        .filter((z) => z.audience === 'feminino' && (z.name === 'Axila' || z.name === 'Pernas'))
        .map((z) => z.id)
      saveScheduleSession(
        s.db,
        s.tenantId,
        s.conversationId,
        {
          serviceId: s.ids.depilacao,
          audienceLine: 'feminino',
          variantIds,
          phase: 'coletando',
        },
        s.clock,
      )
    },
    turns: [{ role: 'client', text: 'Quero outro agendamento' }],
    expect: {
      proposal: false,
      noAppointment: true,
      openProposals: 0,
      turns: [
        {
          turn: 0,
          matches: [/Continuo no feminino|Temos:/i],
          excludes: [/Não encontrei agendamento/i, /nas opções/i],
        },
      ],
      outboundExcludes: NO_LEAK,
    },
  },
  {
    id: 'CC-15',
    title: 'Nome de serviço contido noutro: «massagem relaxante» é um só serviço e marca',
    turnosIdeais: 1,
    // Staging/corpus: «Massagem» e «Massagem relaxante» no mesmo catálogo faziam o resolver
    // contar dois serviços e responder «Marcamos um serviço de cada vez».
    turns: [{ role: 'client', text: 'Quero massagem relaxante amanhã às 15h' }],
    expect: {
      proposal: true,
      noAppointment: true,
      outboundIncludes: ['Serviço: Massagem relaxante'],
      outboundExcludes: [/de cada vez/i],
    },
  },
  {
    id: 'CC-16',
    title: 'Nome de serviço contido noutro: «limpeza de pele profunda» é um só serviço e marca',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Quero limpeza de pele profunda na sexta às 14h' }],
    expect: {
      proposal: true,
      noAppointment: true,
      outboundIncludes: ['Serviço: Limpeza de pele profunda'],
      outboundExcludes: [/de cada vez/i],
    },
  },
  {
    id: 'CC-17',
    title: 'Dois serviços distintos no mesmo pedido continuam a pedir um de cada vez',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Quero massagem relaxante e depilação amanhã' }],
    expect: {
      proposal: false,
      noAppointment: true,
      outboundIncludes: ['um serviço de cada vez'],
    },
  },
  {
    id: 'CC-18',
    title: 'O nome mais curto continua a escolher o serviço curto: «massagem» marca Massagem',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Quero massagem amanhã às 15h' }],
    expect: {
      proposal: true,
      noAppointment: true,
      outboundIncludes: ['Serviço: Massagem\n'],
      outboundExcludes: [/relaxante/i, /de cada vez/i],
    },
  },
  {
    id: 'CC-19',
    title: 'DEC-181: «fim da tarde» propõe os últimos horários da tarde',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Quero massagem sexta no fim da tarde' }],
    expect: {
      proposal: false,
      noAppointment: true,
      // Tarde = 12:00–18:00; a agenda de sexta vai até às 18:00 e a massagem dura 50 min.
      turns: [{ turn: 0, matches: [/\b17:\d\d\b/], excludes: [/\b13:00\b/, /\b13:30\b/] }],
    },
  },
  {
    id: 'CC-20',
    title: 'DEC-181: sem cue de fim, «à tarde» continua a propor os mais cedo',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Quero massagem sexta à tarde' }],
    expect: {
      proposal: false,
      noAppointment: true,
      turns: [{ turn: 0, matches: [/\b13:00\b/], excludes: [/\b17:\d\d\b/] }],
    },
  },
  {
    id: 'CC-21',
    title: 'DEC-181: «final da manhã» propõe os últimos horários da manhã',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Quero massagem sexta no final da manhã' }],
    expect: {
      proposal: false,
      noAppointment: true,
      turns: [{ turn: 0, matches: [/\b11:\d\d\b|\b10:30\b/], excludes: [/\b09:00\b/] }],
    },
  },
  {
    id: 'CC-22',
    title: 'DEC-181: «fim do dia» sem período propõe os últimos horários do dia',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Quero massagem sexta no fim do dia' }],
    expect: {
      proposal: false,
      noAppointment: true,
      turns: [{ turn: 0, matches: [/\b17:\d\d\b/], excludes: [/\b09:00\b/] }],
    },
  },
  {
    id: 'CC-23',
    title: 'Período sem vaga na semana: «sexta à noite» diz que não há e oferece outros horários',
    turnosIdeais: 1,
    // A clínica fecha às 18:00: não há horário à noite em nenhum dia. O funil descartava o
    // período em silêncio e a cliente lia 09:00 sem saber que «à noite» não foi atendido.
    turns: [{ role: 'client', text: 'Quero massagem sexta à noite' }],
    expect: {
      proposal: false,
      noAppointment: true,
      turns: [
        {
          turn: 0,
          matches: [/noite não tenho (horário|nada) livre/i, /\b09:00\b/],
        },
      ],
    },
  },
  {
    id: 'CC-24',
    title: 'Período sem vaga na semana, sem dia: «à noite» também avisa antes de oferecer',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Quero massagem à noite' }],
    expect: {
      proposal: false,
      noAppointment: true,
      turns: [{ turn: 0, matches: [/noite não tenho (horário|nada) livre/i, /\b\d{2}:\d{2}\b/], excludes: [/Para massagem, .*Para massagem, /s] }],
    },
  },
  {
    id: 'CC-25',
    title: 'Período com vaga continua sem aviso: «sexta à tarde» oferece direto',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Quero massagem sexta à tarde' }],
    expect: {
      proposal: false,
      noAppointment: true,
      turns: [{ turn: 0, matches: [/\b13:00\b/], excludes: [/não tenho horário livre/i] }],
    },
  },
]
