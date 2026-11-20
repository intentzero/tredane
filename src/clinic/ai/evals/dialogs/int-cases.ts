/**
 * Família INT- (DEC-202 §2 revisão 18/11/2026): preço, horário e FAQ determinísticos;
 * a classificação de intenção por LLM para o resto fica **Proposto** (cartão t2635s11490).
 *
 * | ID     | Estado    | Descrição resumida |
 * |--------|-----------|--------------------|
 * | INT-01 | Proposto  | Preço de serviço único sem modelo |
 * | INT-02 | Proposto  | Horário de funcionamento sem modelo |
 * | INT-02b| Proposto  | «Abrem amanhã?» com feriado da clínica → fechada, sem modelo |
 * | INT-02c| Proposto  | «Está atendendo hoje?» com feriado no próprio dia → fechada |
 * | INT-02d| Proposto  | Qui 21:42 sem bloqueio: amanhã (sexta) aberta às 09:00 (P26) |
 * | INT-02e| Proposto  | Sex 08:55 sem bloqueio: hoje aberto às 09:00 (P26) |
 * | INT-03 | Proposto  | FAQ de cancelamento sem modelo |
 * | INT-04 | Confirmado| Dois pedidos no mesmo turno (preço + vaga): resposta e link |
 * | INT-05 | Confirmado| Preço após pergunta de linha (rsamp_62934e63) |
 * | INT-06 | Confirmado| «Todas» após pergunta de zonas com linha conhecida |
 * | INT-07 | Proposto  | Pergunta aberta fora do catálogo (recomendação) |
 * | INT-08 | Confirmado| Onde fica: corpo sem URL + Abrir mapa/agenda/equipe (DEC-211 opção B) |
 */
import { createResourceBlock } from '../../../config/blocks'
import { CLINIC_SCOPE_ID } from '../../../config/types'
import { clinicDayBounds } from '../../../scheduling/timezone'
import { saveScheduleSession } from '../../schedule-session'
import type { DialogCase } from './runner'

/** Equivalente a `it.todo` / `it.skip` no harness L1 (DEC-108). */
export const INT_PENDING_LLM_INTENT = 'depende da classificação de intenção por LLM (DEC-202, Proposto)'

export const INT_DIALOG_CASES: DialogCase[] = [
  {
    id: 'INT-01',
    title: 'Preço de serviço único — resposta do cadastro, sem modelo, com «Abrir agenda» e o serviço (P6)',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Quanto custa a limpeza de pele?' }],
    expect: {
      turns: [{ turn: 0, matches: [/R\$\s*180,00/, /60 min/] }],
      turnDecided: [{ modelCalled: false, route: 'skip:web_agendar_link' }],
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'agendar', serviceId: 'Limpeza de pele' }],
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
      outboundExcludes: [/Abrir agenda/i],
    },
  },
  {
    id: 'INT-02b',
    title:
      '«Vocês abrem amanhã?» com feriado da clínica inteira — fechada, sem modelo (DEC-104)',
    turnosIdeais: 1,
    /** Qui 19/11/2026 20:46 America/Sao_Paulo (staging WhatsApp). */
    nowMs: Date.UTC(2026, 10, 19, 23, 46),
    prepare: (s) => {
      const { dayStartsAt, dayEndsAt } = clinicDayBounds('America/Sao_Paulo', '2026-11-20')
      createResourceBlock(
        s.db,
        s.tenantId,
        {
          resourceId: CLINIC_SCOPE_ID,
          startsAt: dayStartsAt,
          endsAt: dayEndsAt,
          reason: 'feriado',
          note: 'Feriado',
        },
        s.clock,
      )
    },
    turns: [{ role: 'client', text: 'Vocês abrem amanhã?' }],
    expect: {
      turns: [
        {
          turn: 0,
          matches: [/fechad|fechamos/i, /amanh[aã]/i],
          excludes: [/09:00/, /est[aá] aberta/i, /Abrir agenda/i],
        },
      ],
      turnDecided: [{ modelCalled: false, route: 'catalog' }],
      outboundExcludes: [/09:00/, /Abrir agenda/i],
    },
  },
  {
    id: 'INT-02c',
    title:
      '«Está atendendo hoje?» com feriado no próprio dia — fechada, sem modelo (DEC-104)',
    turnosIdeais: 1,
    /** Sex 20/11/2026 09:23 America/Sao_Paulo (evidência feriado-contradicao). */
    nowMs: Date.UTC(2026, 10, 20, 12, 23),
    prepare: (s) => {
      const { dayStartsAt, dayEndsAt } = clinicDayBounds('America/Sao_Paulo', '2026-11-20')
      createResourceBlock(
        s.db,
        s.tenantId,
        {
          resourceId: CLINIC_SCOPE_ID,
          startsAt: dayStartsAt,
          endsAt: dayEndsAt,
          reason: 'feriado',
          note: 'Feriado',
        },
        s.clock,
      )
    },
    turns: [
      {
        role: 'client',
        text: 'Bom dia. Gostaria de saber se está atendendo hoje?',
      },
    ],
    expect: {
      turns: [
        {
          turn: 0,
          matches: [/fechad|fechamos/i, /hoje/i],
          excludes: [/09:00/, /estamos atendendo/i, /Abrir agenda/i],
        },
      ],
      turnDecided: [{ modelCalled: false, route: 'catalog' }],
      outboundExcludes: [/09:00/, /Abrir agenda/i],
    },
  },
  {
    id: 'INT-02d',
    title: 'Qui 21:42 sem bloqueio: «abrem amanhã?» é sexta às 09:00 (P26)',
    turnosIdeais: 1,
    /** Qui 19/11/2026 21:42 America/Sao_Paulo. */
    nowMs: Date.UTC(2026, 10, 20, 0, 42),
    turns: [{ role: 'client', text: 'Vocês abrem amanhã?' }],
    expect: {
      notPaused: true,
      turns: [
        {
          turn: 0,
          matches: [/amanh[aã].*sexta/i, /09:00/],
          excludes: [/fechad/i, /s[aá]bado/i],
        },
      ],
      turnDecided: [{ modelCalled: false, route: 'catalog' }],
    },
  },
  {
    id: 'INT-02e',
    title: 'Sex 08:55 sem bloqueio: «está atendendo hoje?» é sexta às 09:00 (P26)',
    turnosIdeais: 1,
    /** Sex 20/11/2026 08:55 America/Sao_Paulo. */
    nowMs: Date.UTC(2026, 10, 20, 11, 55),
    turns: [{ role: 'client', text: 'Gostaria de saber se está atendendo hoje?' }],
    expect: {
      notPaused: true,
      turns: [
        {
          turn: 0,
          matches: [/hoje.*sexta/i, /09:00/],
          excludes: [/fechad/i],
        },
      ],
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
    id: 'INT-08',
    title:
      'Onde fica — corpo sem URL + Abrir mapa · Abrir agenda · Equipe (DEC-211 opção B)',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Onde fica a clínica?' }],
    expect: {
      notPaused: true,
      outboundIncludes: ['mapa'],
      outboundExcludes: [/Não tenho/i, /Rua /i, /https?:\/\//i, /toque em «Abrir agenda»/i],
      turnDecided: [{ modelCalled: false }],
      assert: (s) => {
        const row = s.db.get<{ interactive_json: string | null; body: string }>(
          `SELECT o.interactive_json AS interactive_json, m.body AS body
           FROM outbound_messages o
           JOIN messages m ON m.id = o.message_id
           WHERE o.tenant_id = ? AND m.conversation_id = ?
           ORDER BY o.created_at DESC LIMIT 1`,
          s.tenantId,
          s.conversationId,
        )
        if (!row?.interactive_json) return ['INT-08: resposta sem interactivo']
        if (/https?:\/\//i.test(row.body ?? '')) {
          return ['INT-08: corpo ainda tem URL (opção B remove o link da bolha)']
        }
        const parsed = JSON.parse(row.interactive_json) as {
          buttons?: Array<{ id: string; title: string }>
          ctaUrl?: unknown
        }
        if (parsed.ctaUrl) return ['INT-08: cta_url na 1.ª bolha (mapa só após toque)']
        const buttons = parsed.buttons ?? []
        const titles = buttons.map((b) => b.title)
        if (
          titles.length !== 3 ||
          titles[0] !== 'Abrir mapa' ||
          titles[1] !== 'Abrir agenda' ||
          titles[2] !== 'Falar com a equipe'
        ) {
          return [`INT-08: esperava Abrir mapa · Abrir agenda · Equipe, veio ${JSON.stringify(buttons)}`]
        }
        return []
      },
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
      outboundExcludes: [/Quer ver hor[aá]rios/i],
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