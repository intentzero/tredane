/**
 * Família INT- (DEC-202 §2 revisão 18/11/2026): preço, horário e FAQ determinísticos;
 * a classificação de intenção por LLM para o resto fica **Proposto** (cartão t2635s11490).
 *
 * | ID     | Estado    | Descrição resumida |
 * |--------|-----------|--------------------|
 * | INT-01 | Proposto  | Preço de serviço único sem modelo |
 * | INT-02 | Proposto  | Horário de funcionamento sem modelo |
 * | INT-03 | Proposto  | FAQ de cancelamento sem modelo |
 * | INT-04 | Confirmado| Dois pedidos no mesmo turno (preço + vaga): resposta e link |
 * | INT-05 | Confirmado| Preço após pergunta de linha (rsamp_62934e63) |
 * | INT-06 | Confirmado| «Todas» após pergunta de zonas com linha conhecida |
 * | INT-07 | Proposto  | Pergunta aberta fora do catálogo (recomendação) |
 */
import { saveScheduleSession } from '../../schedule-session'
import type { DialogCase } from './runner'

/** Equivalente a `it.todo` / `it.skip` no harness L1 (DEC-108). */
export const INT_PENDING_LLM_INTENT = 'depende da classificação de intenção por LLM (DEC-202, Proposto)'

export const INT_DIALOG_CASES: DialogCase[] = [
  {
    id: 'INT-01',
    title: 'Preço de serviço único — resposta do cadastro, sem modelo',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Quanto custa a limpeza de pele?' }],
    expect: {
      turns: [{ turn: 0, matches: [/R\$\s*180,00/, /60 min/] }],
      turnDecided: [{ modelCalled: false, route: 'catalog' }],
      outboundExcludes: [/Abrir agenda/i],
    },
  },
  {
    id: 'INT-02',
    title: 'Horário de funcionamento — expediente cadastrado, sem modelo',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Qual o horário de funcionamento de vocês?' }],
    expect: {
      turns: [{ turn: 0, matches: [/Funcionamos|Nosso horário|Abrimos assim/i, /09:00/] }],
      turnDecided: [{ modelCalled: false, route: 'catalog' }],
    },
  },
  {
    id: 'INT-03',
    title: 'FAQ de cancelamento — política cadastrada, sem modelo',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'como funciona o cancelamento se eu marcar?' }],
    expect: {
      notPaused: true,
      outboundIncludes: ['24h'],
      outboundExcludes: [/Não entendi/i, /Quer ver as op[cç][oõ]es/i],
      turnDecided: [{ modelCalled: false }],
    },
  },
  {
    id: 'INT-04',
    title: 'Preço e vaga no mesmo turno — responde ao preço e junta o link (DEC-202, 18/11/2026)',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Quanto custa a limpeza de pele e tem horário amanhã?' }],
    expect: {
      turns: [{ turn: 0, matches: [/R\$/, /Abrir agenda/i] }],
      proposal: false,
      noAppointment: true,
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'agendar', serviceId: 'Limpeza de pele' }],
      outboundCount: 1,
    },
  },
  {
    id: 'INT-04b',
    title: 'Preço e vaga no mesmo turno com a pausa da owner — passa à equipe, sem link',
    turnosIdeais: 1,
    ownerPaused: true,
    turns: [{ role: 'client', text: 'Quanto custa a limpeza de pele e tem horário amanhã?' }],
    expect: { noCtaUrl: true, paused: true, teamAlert: true, noAppointment: true },
  },
  {
    id: 'INT-05',
    title: 'Valores da depilação → linha masculina lista preços sem modelo',
    turnosIdeais: 2,
    turns: [
      { role: 'client', text: 'Quais os valores da depilação?' },
      { role: 'client', text: 'Masculina' },
    ],
    expect: {
      turns: [
        { turn: 0, excludes: [/R\$/] },
        {
          turn: 1,
          matches: [/R\$\s*50,00/, /R\$\s*140,00/],
          excludes: [/google/i, /equipe confirma o valor da clínica/i],
        },
      ],
      turnDecided: [{ modelCalled: false }, { modelCalled: false }],
      outboundExcludes: [/maps\.google/i, /Não tenho os valores/i],
    },
  },
  {
    id: 'INT-06',
    title: 'Linha masculina conhecida → «Todas» lista tabela de preços',
    turnosIdeais: 2,
    prepare: (s) => {
      saveScheduleSession(
        s.db,
        s.tenantId,
        s.conversationId,
        { serviceId: s.ids.depilacao, audienceLine: 'masculino' },
        s.clock,
      )
    },
    turns: [
      { role: 'client', text: 'Quanto custa a depilação?' },
      { role: 'client', text: 'Todas' },
    ],
    expect: {
      turns: [
        { turn: 0, matches: [/zonas/i], excludes: [/R\$/] },
        {
          turn: 1,
          matches: [/R\$\s*50,00/, /R\$\s*140,00/],
          excludes: [/Não tenho os valores/i],
        },
      ],
      turnDecided: [{ modelCalled: false }, { modelCalled: false }],
    },
  },
  {
    id: 'INT-07',
    title: 'Recomendação entre serviços — pergunta aberta (Proposto)',
    turnosIdeais: 1,
    pendingHarness: INT_PENDING_LLM_INTENT,
    turns: [{ role: 'client', text: 'Vocês recomendam fazer limpeza antes do peeling?' }],
    expect: {
      // Com classificador LLM (Proposto): resposta validada, sem reapresentar catálogo.
      turns: [
        {
          turn: 0,
          excludes: [/Qual serviço você gostaria de agendar/i, /Quer ver as opções/i],
        },
      ],
      turnDecided: [{ modelCalled: true }],
    },
  },
]