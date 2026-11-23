/**
 * Família INT- (DEC-202 §2 revisão 18/11/2026): preço, horário e FAQ determinísticos;
 * Classificador de etiqueta (DEC-221): staging `INTENT_LLM_ENABLED`; testes de apply em
 * `intent-llm-apply.test.ts` (price/team/faq_catalog/faq_clinic). L1 abaixo cobre o caminho léxico.
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
 * | INT-03b| Confirmado| Sinal + B atraso: junção A + frase + B (DEC-210 revisão) |
 * | INT-03c| Confirmado| Sinal ligado + B vazio: só texto do Recebimento |
 * | INT-04 | Confirmado| Dois pedidos no mesmo turno (preço + vaga): resposta e link |
 * | INT-05 | Confirmado| Preço após pergunta de linha (rsamp_62934e63) |
 * | INT-06 | Confirmado| «Todas» após pergunta de zonas com linha conhecida |
 * | INT-07 | Proposto  | Pergunta aberta fora do catálogo (recomendação) — ainda redator |
 * | INT-08 | Confirmado| Onde fica: corpo sem URL + cta_url Abrir mapa (um toque; DEC-211) |
 * | INT-08b| Confirmado| Paráfrase «Onde atendem?» → mesmo cta_url Abrir mapa (sem URL no corpo) |
 * | INT-09 | Confirmado| Valor da massagem → tipo → «Relaxante» responde R$ (sem modelo) |
 * | INT-10 | Confirmado| FAQ DEC-185 com cumprimento «Boa tarde» → texto publicado (TRE-60) |
 * | INT-13 | Confirmado| «O que inclui a íntima?» → client_explanation + Abrir agenda home (TRE-100 / DEC-220) |
 * | INT-14 | Confirmado| Íntima sem explicação → missing + Abrir agenda home, sem LLM (TRE-100) |
 * | INT-15 | Confirmado| «Fazem depilação íntima?» → client_explanation + Abrir agenda home, sem LLM (TRE-112) |
 * | INT-16 | Confirmado| faq_catalog ambíguo («depilação e massagem») → «De qual serviço?», sem LLM (TRE-113) |
 * | INT-17 | Confirmado| FAQ oferta → «Qual o valor?» usa ActiveCatalogSubject (DEC-223 / TRE-121) |
 */
import { listServices, replaceServiceZonesOp, upsertServiceOp } from '../../../config'
import { createResourceBlock } from '../../../config/blocks'
import { upsertKnowledgeCategory, upsertKnowledgeEntry } from '../../../config/knowledge'
import { setClinicAiProfile } from '../../../config/settings'
import { CLINIC_SCOPE_ID } from '../../../config/types'
import { updatePixSignalSettings } from '../../../pix/signal-settings'
import { clinicDayBounds } from '../../../scheduling/timezone'
import { POLICY_JOIN_PHRASE } from '../../policy-join'
import { saveScheduleSession } from '../../schedule-session'
import type { DialogCase } from './runner'
import type { DialogScenario } from './scenario'

/** Equivalente a `it.todo` / `it.skip` no harness L1 (DEC-108). */
export const INT_PENDING_LLM_INTENT =
  'pergunta aberta: redator + validador (DEC-104/107); classificador DEC-221 não fecha este caso'

/** INT-08 / INT-08b: 1.ª bolha sem URL + só cta_url «Abrir mapa» (um toque; Meta). */
function assertLocationMapOffer(s: DialogScenario, caseId: string): string[] {
  const row = s.db.get<{ interactive_json: string | null; body: string }>(
    `SELECT o.interactive_json AS interactive_json, m.body AS body
     FROM outbound_messages o
     JOIN messages m ON m.id = o.message_id
     WHERE o.tenant_id = ? AND m.conversation_id = ?
     ORDER BY o.created_at DESC LIMIT 1`,
    s.tenantId,
    s.conversationId,
  )
  if (!row?.interactive_json) return [`${caseId}: resposta sem interactivo`]
  if (/https?:\/\//i.test(row.body ?? '')) {
    return [`${caseId}: corpo ainda tem URL (opção B remove o link da bolha)`]
  }
  const parsed = JSON.parse(row.interactive_json) as {
    buttons?: Array<{ id: string; title: string }>
    ctaUrl?: { displayText?: string; url?: string }
  }
  if (parsed.buttons?.length) {
    return [
      `${caseId}: 1.ª bolha não deve misturar reply com cta_url; veio ${JSON.stringify(parsed.buttons)}`,
    ]
  }
  if (parsed.ctaUrl?.displayText !== 'Abrir mapa') {
    return [
      `${caseId}: esperava cta_url «Abrir mapa», veio ${JSON.stringify(parsed.ctaUrl?.displayText)}`,
    ]
  }
  if (!parsed.ctaUrl?.url?.startsWith('https://')) {
    return [`${caseId}: cta_url sem https Maps, veio ${JSON.stringify(parsed.ctaUrl?.url)}`]
  }
  return []
}

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
      clientWebPurposes: [{ purpose: 'home', serviceId: null }],
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
          matches: [/amanh[aã] \(sexta-feira\): fechado/i, /s[aá]bado: 09:00/],
          excludes: [/sexta-feira\): 09:00/i, /est[aá] aberta/i, /Abrir agenda/i],
        },
      ],
      turnDecided: [{ modelCalled: false, route: 'catalog' }],
      outboundExcludes: [/sexta-feira\): 09:00/i, /Abrir agenda/i],
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
          matches: [/hoje \(sexta-feira\): fechado/i, /s[aá]bado\): 09:00/],
          excludes: [/sexta-feira\): 09:00/i, /estamos atendendo/i, /Abrir agenda/i],
        },
      ],
      turnDecided: [{ modelCalled: false, route: 'catalog' }],
      outboundExcludes: [/sexta-feira\): 09:00/i, /Abrir agenda/i],
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
    id: 'INT-03b',
    title: 'Sinal + regras gerais de atraso: cliente recebe A e B juntos (DEC-210)',
    turnosIdeais: 1,
    prepare: (s) => {
      updatePixSignalSettings(
        s.db,
        s.tenantId,
        { enabled: true, amountKind: 'fixed', fixedCents: 5000 },
        s.clock,
      )
      setClinicAiProfile(
        s.db,
        s.tenantId,
        { reschedulePolicy: 'Atrasos acima de 15 minutos podem perder o horário.' },
        s.clock,
      )
    },
    turns: [{ role: 'client', text: 'como funciona o cancelamento se eu marcar?' }],
    expect: {
      notPaused: true,
      outboundIncludes: [POLICY_JOIN_PHRASE, 'Atrasos acima de 15 minutos', 'R$'],
      outboundExcludes: [/Não entendi/i],
      turnDecided: [{ modelCalled: false }],
    },
  },
  {
    id: 'INT-03c',
    title: 'Sinal ligado e B vazio: só o texto do Recebimento',
    turnosIdeais: 1,
    prepare: (s) => {
      updatePixSignalSettings(
        s.db,
        s.tenantId,
        { enabled: true, amountKind: 'fixed', fixedCents: 5000 },
        s.clock,
      )
      setClinicAiProfile(s.db, s.tenantId, { reschedulePolicy: '' }, s.clock)
    },
    turns: [{ role: 'client', text: 'como funciona o cancelamento se eu marcar?' }],
    expect: {
      notPaused: true,
      outboundIncludes: ['R$'],
      outboundExcludes: [new RegExp(POLICY_JOIN_PHRASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), /Não entendi/i],
      turnDecided: [{ modelCalled: false }],
    },
  },
  {
    id: 'INT-08',
    title: 'Onde fica — corpo sem URL + cta_url Abrir mapa (um toque; DEC-211)',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Onde fica a clínica?' }],
    expect: {
      notPaused: true,
      outboundIncludes: ['mapa'],
      outboundExcludes: [
        /Não tenho/i,
        /Rua /i,
        /https?:\/\//i,
        /toque em «Abrir agenda»/i,
        /Para ver o caminho, toque/i,
      ],
      turnDecided: [{ modelCalled: false }],
      assert: (s) => assertLocationMapOffer(s, 'INT-08'),
    },
  },
  {
    id: 'INT-08b',
    title: 'Onde atendem — paráfrase com o mesmo cta_url Abrir mapa (um toque)',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Onde atendem?' }],
    expect: {
      notPaused: true,
      outboundIncludes: ['mapa'],
      outboundExcludes: [
        /Não tenho/i,
        /Rua /i,
        /https?:\/\//i,
        /toque em «Abrir agenda»/i,
        /Para ver o caminho, toque/i,
      ],
      turnDecided: [{ modelCalled: false }],
      assert: (s) => assertLocationMapOffer(s, 'INT-08b'),
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
      clientWebPurposes: [{ purpose: 'home', serviceId: null }],
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
    title: 'Valores da depilação → faixa com R$ no 1.º turno, sem modelo (TRE-94)',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Quais os valores da depilação?' }],
    expect: {
      turns: [
        {
          turn: 0,
          matches: [/R\$\s*25,00/, /R\$\s*140,00/],
          excludes: [/Não tenho os valores/i, /feminina ou masculina/i],
        },
      ],
      turnDecided: [{ modelCalled: false }],
      outboundExcludes: [/maps\.google/i, /Não tenho os valores/i],
      noAppointment: true,
    },
  },
  {
    id: 'INT-06',
    title: 'Linha masculina conhecida → preço lista tabela da linha (TRE-94)',
    turnosIdeais: 1,
    prepare: (s) => {
      saveScheduleSession(
        s.db,
        s.tenantId,
        s.conversationId,
        { serviceId: s.ids.depilacao, audienceLine: 'masculino' },
        s.clock,
      )
    },
    turns: [{ role: 'client', text: 'Quanto custa a depilação?' }],
    expect: {
      turns: [
        {
          turn: 0,
          matches: [/R\$\s*50,00/, /R\$\s*140,00/, /Axila|Pernas/i],
          excludes: [/Não tenho os valores/i],
        },
      ],
      turnDecided: [{ modelCalled: false }],
      noAppointment: true,
    },
  },
  {
    id: 'INT-09',
    title: 'Valor da massagem lista tipos com R$ do catálogo, sem modelo (TRE-94)',
    turnosIdeais: 1,
    prepare: (s) => {
      const massagem = listServices(s.db, s.tenantId).find((row) => row.name === 'Massagem')
      if (!massagem) throw new Error('INT-09: serviço Massagem ausente no cenário')
      upsertServiceOp(
        s.db,
        s.caller,
        {
          id: massagem.id,
          name: massagem.name,
          durationMinutes: 60,
          bufferMinutes: massagem.bufferMinutes,
          priceCents: null,
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
          {
            name: 'Liberação miofascial',
            audience: 'ambos',
            durationMinutes: 60,
            priceCents: 20_000,
          },
          {
            name: 'Ventosaterapia',
            audience: 'ambos',
            durationMinutes: 60,
            priceCents: 20_000,
          },
          {
            name: 'Drenagem linfática',
            audience: 'ambos',
            durationMinutes: 60,
            priceCents: 20_000,
          },
          {
            name: 'Massagem relaxante',
            audience: 'ambos',
            durationMinutes: 60,
            priceCents: 20_000,
          },
        ],
        s.clock,
      )
    },
    turns: [{ role: 'client', text: 'Qual o valor da massagem?' }],
    expect: {
      turns: [
        {
          turn: 0,
          matches: [/relaxante/i, /R\$\s*200,00/],
          excludes: [/não tenho o valor/i, /equipe confirma o valor/i, /qual tipo\?/i],
        },
      ],
      turnDecided: [{ modelCalled: false }],
      outboundExcludes: [/não tenho o valor/i],
      noAppointment: true,
    },
  },
  {
    id: 'INT-11',
    title: '«quanto custa a depilacao» (sem acento) → faixa R$, Abrir agenda, sem Equipe (TRE-94)',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'quanto custa a depilacao' }],
    expect: {
      turns: [
        {
          turn: 0,
          matches: [/R\$\s*25,00/, /R\$\s*140,00/],
          excludes: [/Não tenho os valores/i, /Falar com a equipe/i],
        },
      ],
      turnDecided: [{ modelCalled: false }],
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'home', serviceId: null }],
      noAppointment: true,
      outboundExcludes: [/Não tenho os valores/i],
    },
  },
  {
    id: 'INT-12',
    title: '«quanto custa o bronzeamento» → R$ 150 + Abrir agenda, sem Equipe (TRE-94)',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'quanto custa o bronzeamento' }],
    expect: {
      turns: [
        {
          turn: 0,
          matches: [/R\$\s*150,00/],
          excludes: [/Não tenho/i, /Falar com a equipe/i],
        },
      ],
      turnDecided: [{ modelCalled: false }],
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'home', serviceId: null }],
      noAppointment: true,
    },
  },
  {
    id: 'INT-10',
    title:
      'FAQ Pets com «Boa tarde» — texto publicado DEC-185, sem saltar pelo PERIOD do cumprimento (TRE-60)',
    turnosIdeais: 1,
    prepare: (s) => {
      const cat = upsertKnowledgeCategory(s.db, s.tenantId, { name: 'Pets' }, s.clock)
      upsertKnowledgeEntry(
        s.db,
        s.tenantId,
        {
          categoryId: cat.id,
          question: 'Posso levar o meu pet?',
          answer: 'Sim, os seus bichanos são muito bem vindos!',
          status: 'published',
        },
        'owner',
        s.clock,
      )
    },
    turns: [{ role: 'client', text: 'Boa tarde, posso levar o meu pet?' }],
    expect: {
      notPaused: true,
      turns: [
        {
          turn: 0,
          matches: [/bichanos são muito bem vindos/i],
          excludes: [/Não entendi/i, /Quer ver as op[cç][oõ]es/i],
        },
      ],
      turnDecided: [{ modelCalled: false, route: 'catalog' }],
    },
  },
  {
    id: 'INT-13',
    title:
      '«O que inclui a íntima?» → client_explanation + Abrir agenda home, sem modelo nem prosa do serviço (TRE-100 / DEC-220)',
    turnosIdeais: 1,
    prepare: (s) => {
      const depilacao = listServices(s.db, s.tenantId).find((row) => row.name === 'Depilação')
      if (!depilacao) throw new Error('INT-13: serviço Depilação ausente no cenário')
      upsertServiceOp(
        s.db,
        s.caller,
        {
          id: depilacao.id,
          name: depilacao.name,
          durationMinutes: depilacao.durationMinutes,
          bufferMinutes: depilacao.bufferMinutes,
          priceCents: depilacao.priceCents,
          professionalIds: depilacao.professionalIds,
          roomRequirement: depilacao.roomRequirement,
          variantKind: 'zona',
          variantKindPlural: 'zonas',
          clientExplanation: 'Remoção dos pelos pela raiz utilizando cera depilatória.',
        },
        s.clock,
      )
      // Reusa ids das zonas existentes (replaceZones inserir+apagar falha no UNIQUE).
      replaceServiceZonesOp(
        s.db,
        s.caller,
        depilacao.id,
        [
          ...depilacao.zones.map((zone) => ({
            id: zone.id,
            name: zone.name,
            audience: zone.audience,
            durationMinutes: zone.durationMinutes,
            priceCents: zone.priceCents,
            synonyms: zone.synonyms,
            clientExplanation: zone.clientExplanation,
            clientExplanationAudience: zone.clientExplanationAudience ?? null,
          })),
          {
            name: 'Intima',
            audience: 'feminino' as const,
            durationMinutes: 20,
            priceCents: 15_000,
            clientExplanation: 'Inclui virilha e genital no feminino.',
          },
          {
            name: 'Intima',
            audience: 'masculino' as const,
            durationMinutes: 20,
            priceCents: 20_000,
            clientExplanation: 'Zona íntima com cera.',
            clientExplanationAudience: 'Inclui virilha, genital e perianal no masculino.',
          },
        ],
        s.clock,
      )
    },
    turns: [{ role: 'client', text: 'O que inclui a íntima?' }],
    expect: {
      notPaused: true,
      noAppointment: true,
      turns: [
        {
          turn: 0,
          matches: [/Inclui virilha e genital no feminino/i],
          excludes: [
            /Remoção dos pelos/i,
            /cera depilatória/i,
            /Não tenho esse detalhe/i,
            /Falar com a equipe/i,
            /repasso para a equipe/i,
          ],
        },
      ],
      turnDecided: [{ modelCalled: false, route: 'catalog' }],
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'home', serviceId: null }],
      outboundExcludes: [/Falar com a equipe/i, /Remoção dos pelos/i],
    },
  },
  {
    id: 'INT-14',
    title:
      'Íntima sem explicação → frase missing + Abrir agenda home, sem LLM nem prosa do serviço (TRE-100)',
    turnosIdeais: 1,
    prepare: (s) => {
      const depilacao = listServices(s.db, s.tenantId).find((row) => row.name === 'Depilação')
      if (!depilacao) throw new Error('INT-14: serviço Depilação ausente no cenário')
      upsertServiceOp(
        s.db,
        s.caller,
        {
          id: depilacao.id,
          name: depilacao.name,
          durationMinutes: depilacao.durationMinutes,
          bufferMinutes: depilacao.bufferMinutes,
          priceCents: depilacao.priceCents,
          professionalIds: depilacao.professionalIds,
          roomRequirement: depilacao.roomRequirement,
          variantKind: 'zona',
          variantKindPlural: 'zonas',
          clientExplanation: 'Remoção dos pelos pela raiz utilizando cera depilatória.',
        },
        s.clock,
      )
      replaceServiceZonesOp(
        s.db,
        s.caller,
        depilacao.id,
        [
          ...depilacao.zones.map((zone) => ({
            id: zone.id,
            name: zone.name,
            audience: zone.audience,
            durationMinutes: zone.durationMinutes,
            priceCents: zone.priceCents,
            synonyms: zone.synonyms,
            clientExplanation: zone.clientExplanation,
            clientExplanationAudience: zone.clientExplanationAudience ?? null,
          })),
          {
            name: 'Intima',
            audience: 'feminino' as const,
            durationMinutes: 20,
            priceCents: 15_000,
            clientExplanation: null,
          },
        ],
        s.clock,
      )
    },
    turns: [{ role: 'client', text: 'O que inclui a íntima?' }],
    expect: {
      notPaused: true,
      noAppointment: true,
      turns: [
        {
          turn: 0,
          matches: [/Não tenho esse detalhe no cadastro; a equipe confirma/i],
          excludes: [/Remoção dos pelos/i, /Falar com a equipe/i, /repasso para a equipe/i],
        },
      ],
      turnDecided: [{ modelCalled: false }],
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'home', serviceId: null }],
      outboundExcludes: [/Remoção dos pelos/i, /Falar com a equipe/i],
    },
  },
  {
    id: 'INT-15',
    title:
      '«Fazem depilação íntima?» → client_explanation + Abrir agenda home, sem modelo nem «não tenho com certeza» (TRE-112)',
    turnosIdeais: 1,
    prepare: (s) => {
      const depilacao = listServices(s.db, s.tenantId).find((row) => row.name === 'Depilação')
      if (!depilacao) throw new Error('INT-15: serviço Depilação ausente no cenário')
      upsertServiceOp(
        s.db,
        s.caller,
        {
          id: depilacao.id,
          name: depilacao.name,
          durationMinutes: depilacao.durationMinutes,
          bufferMinutes: depilacao.bufferMinutes,
          priceCents: depilacao.priceCents,
          professionalIds: depilacao.professionalIds,
          roomRequirement: depilacao.roomRequirement,
          variantKind: 'zona',
          variantKindPlural: 'zonas',
          clientExplanation: 'Remoção dos pelos pela raiz utilizando cera depilatória.',
        },
        s.clock,
      )
      replaceServiceZonesOp(
        s.db,
        s.caller,
        depilacao.id,
        [
          ...depilacao.zones.map((zone) => ({
            id: zone.id,
            name: zone.name,
            audience: zone.audience,
            durationMinutes: zone.durationMinutes,
            priceCents: zone.priceCents,
            synonyms: zone.synonyms,
            clientExplanation: zone.clientExplanation,
            clientExplanationAudience: zone.clientExplanationAudience ?? null,
          })),
          {
            name: 'íntima',
            audience: 'feminino' as const,
            durationMinutes: 30,
            priceCents: 12_000,
            clientExplanation:
              'A depilação íntima com cera é um procedimento de remoção dos pelos pela raiz.',
          },
        ],
        s.clock,
      )
    },
    turns: [{ role: 'client', text: 'Fazem depilação íntima?' }],
    expect: {
      notPaused: true,
      noAppointment: true,
      turns: [
        {
          turn: 0,
          matches: [/depilação íntima com cera/i],
          excludes: [
            /Remoção dos pelos pela raiz utilizando cera depilatória/i,
            /não tenho.*certeza/i,
            /Não tenho esse detalhe/i,
            /Falar com a equipe/i,
            /repasso para a equipe/i,
          ],
        },
      ],
      turnDecided: [{ modelCalled: false, route: 'catalog' }],
      clientWebOffers: 1,
      clientWebPurposes: [{ purpose: 'home', serviceId: null }],
      outboundExcludes: [/Falar com a equipe/i, /não tenho.*certeza/i],
    },
  },
  {
    id: 'INT-16',
    title:
      'faq_catalog ambíguo («Como é a depilação e a massagem?») → «De qual serviço?», sem modelo nem Abrir agenda (TRE-113)',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Como é a depilação e a massagem?' }],
    expect: {
      notPaused: true,
      noAppointment: true,
      turns: [
        {
          turn: 0,
          matches: [/^De qual serviço\?$/],
          excludes: [
            /Não tenho esse detalhe/i,
            /Falar com a equipe/i,
            /repasso para a equipe/i,
            /Abrir agenda/i,
          ],
        },
      ],
      turnDecided: [{ modelCalled: false, route: 'catalog' }],
      clientWebOffers: 0,
      outboundExcludes: [/Falar com a equipe/i, /Abrir agenda/i],
    },
  },
  {
    id: 'INT-17',
    title:
      '«Fazem depilação íntima?» → «Qual o valor?» → R$ do cadastro sem modelo (DEC-223 / TRE-121)',
    turnosIdeais: 2,
    prepare: (s) => {
      const depilacao = listServices(s.db, s.tenantId).find((row) => row.name === 'Depilação')
      if (!depilacao) throw new Error('INT-17: serviço Depilação ausente no cenário')
      upsertServiceOp(
        s.db,
        s.caller,
        {
          id: depilacao.id,
          name: depilacao.name,
          durationMinutes: depilacao.durationMinutes,
          bufferMinutes: depilacao.bufferMinutes,
          priceCents: depilacao.priceCents,
          professionalIds: depilacao.professionalIds,
          roomRequirement: depilacao.roomRequirement,
          variantKind: 'zona',
          variantKindPlural: 'zonas',
          clientExplanation: 'Remoção dos pelos pela raiz.',
        },
        s.clock,
      )
      replaceServiceZonesOp(
        s.db,
        s.caller,
        depilacao.id,
        [
          ...depilacao.zones.map((zone) => ({
            id: zone.id,
            name: zone.name,
            audience: zone.audience,
            durationMinutes: zone.durationMinutes,
            priceCents: zone.priceCents,
            synonyms: zone.synonyms,
            clientExplanation: zone.clientExplanation,
            clientExplanationAudience: zone.clientExplanationAudience ?? null,
          })),
          {
            name: 'íntima',
            audience: 'feminino' as const,
            durationMinutes: 30,
            priceCents: 12_000,
            // Sem explicação → oferta «Sim, fazemos íntima.» (TRE-112)
          },
        ],
        s.clock,
      )
    },
    turns: [
      { role: 'client', text: 'Fazem depilação íntima?' },
      { role: 'client', text: 'Qual o valor?' },
    ],
    expect: {
      notPaused: true,
      noAppointment: true,
      turns: [
        {
          turn: 0,
          matches: [/Sim, fazemos íntima/i],
          excludes: [/Falar com a equipe/i, /não tenho.*certeza/i],
        },
        {
          turn: 1,
          matches: [/12\.000|12,00|R\$/],
          excludes: [
            /equipe confirma/i,
            /Não tenho esse detalhe/i,
            /não tenho.*certeza/i,
            /Falar com a equipe/i,
          ],
        },
      ],
      turnDecided: [
        { modelCalled: false, route: 'catalog' },
        { modelCalled: false, route: 'catalog' },
      ],
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