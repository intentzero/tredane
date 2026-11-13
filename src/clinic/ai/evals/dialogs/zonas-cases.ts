/**
 * Zonas em texto livre e telemetria do funil (DEC-143, 06/11/2026) — metodologia 0.6 (G-09).
 * Entraram na `main` (#589, #588) só com testes unitários; estes diálogos fixam o comportamento.
 * A-38: T2 friction `nao_encontrei` (session-analytics).
 * A-44..A-46: singular↔plural + stopwords pt-BR (Paulo 10/11/2026).
 * A-48: lista Horários sem description=title (Meta echo duplicava o bubble).
 * A-50: «gostaria de saber» não ecoa «saber» como zona (staging).
 * A-53 / A-54: FAQ gate mid-zonas (DEC-177) — pergunta ≠ leftover.
 *
 * Relógio por defeito: qui 05/11/2026 10:00 America/Sao_Paulo. Catálogo de referência:
 * Depilação com Axila, Pernas (feminino e masculino, DEC-079) e Buço (ambos).
 */
import { getService, listZones, replaceServiceZonesOp, upsertServiceOp } from '../../../config'
import { frictionTermHash } from '../../turn-friction'
import type { DialogCase } from './runner'

const NO_LEAK = [/maps\.google|goo\.gl/i, /\{|\}/]
const COTOVELO_HASH = frictionTermHash('cotovelo')!

/** Staging smoke: acrescenta Intima (e Braços) sem recriar as zonas base. */
function withIntimaZones(
  s: Parameters<NonNullable<DialogCase['prepare']>>[0],
  extras: Array<{
    name: string
    audience: 'feminino' | 'masculino' | 'ambos'
    durationMinutes: number
    priceCents: number
  }> = [
    { name: 'Intima', audience: 'feminino', durationMinutes: 20, priceCents: 15000 },
    { name: 'Braços', audience: 'feminino', durationMinutes: 20, priceCents: 8000 },
  ],
): void {
  const prior = listZones(s.db, s.tenantId, s.ids.depilacao)
  const missing = extras.filter(
    (extra) => !prior.some((z) => z.name === extra.name && z.audience === extra.audience),
  )
  if (missing.length === 0) return
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
      ...missing,
    ],
    s.clock,
  )
}

function withMasculineIntimaZones(s: Parameters<NonNullable<DialogCase['prepare']>>[0]): void {
  withIntimaZones(s, [
    { name: 'Intima', audience: 'masculino', durationMinutes: 20, priceCents: 18000 },
  ])
}

/**
 * Intima sem sinónimo + Explicação genérica no serviço.
 * Bugbot/DEC-177: cobertura sem prova não pode cair nessa explicação.
 */
function withIntimaAndServiceExplanation(
  s: Parameters<NonNullable<DialogCase['prepare']>>[0],
): void {
  withIntimaZones(s)
  const dep = getService(s.db, s.tenantId, s.ids.depilacao)
  if (!dep) throw new Error('A-53: Depilação ausente')
  upsertServiceOp(
    s.db,
    s.caller,
    {
      id: dep.id,
      name: dep.name,
      durationMinutes: dep.durationMinutes,
      bufferMinutes: dep.bufferMinutes,
      priceCents: dep.priceCents,
      clientExplanation: 'Retirada de pelos com cera em várias zonas do corpo.',
      professionalIds: dep.professionalIds,
      roomRequirement: dep.roomRequirement,
      audiencia: dep.audiencia,
      variantKind: dep.variantKind,
      variantKindPlural: dep.variantKindPlural,
      variantSelection: dep.variantSelection,
    },
    s.clock,
  )
}

/** Intima com sinónimo ânus (DEC-110 / «O que a IA reconhece») para FAQ de cobertura. */
function withIntimaAnusSynonym(s: Parameters<NonNullable<DialogCase['prepare']>>[0]): void {
  const prior = listZones(s.db, s.tenantId, s.ids.depilacao)
  const hasIntima = prior.some((z) => z.name === 'Intima' && z.audience === 'feminino')
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
        synonyms:
          z.name === 'Intima' && z.audience === 'feminino'
            ? Array.from(new Set([...(z.synonyms ?? []), 'anus']))
            : z.synonyms,
      })),
      ...(hasIntima
        ? []
        : [
            {
              name: 'Intima',
              audience: 'feminino' as const,
              durationMinutes: 20,
              priceCents: 15000,
              synonyms: ['anus'],
            },
          ]),
    ],
    s.clock,
  )
}

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
        { turn: 1, matches: [/Entendi: axila, pernas\. Certo\?/], excludes: [/quais zonas|Temos Axila/i] },
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
      turns: [{ turn: 1, matches: [/Entendi: axila, pernas\. Certo\?/] }],
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
      turns: [{ turn: 1, matches: [/Entendi: axila, pernas\. Certo\?/] }],
    },
  },
  {
    id: 'A-38',
    title: 'Telemetria T2: «Axila e cotovelo» emite friction nao_encontrei (sem termo em claro)',
    turnosIdeais: 2,
    // session-analytics T2: option-miss (#509 / zone-echo) → friction. Falha sem a flag.
    // Paulo 10/11 opção 2: eco do que casou + pergunta só da sobra (sem Sim/Corrigir).
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
          matches: [
            /Entendi: axila\./i,
            /Não encontrei cotovelo nas opções/i,
            // Discovery reset (Paulo 09/11/2026): one-shot hint no option-miss.
            /Para recomeçar, diga começar de novo/i,
            /Para parar, diga terminar/i,
          ],
          excludes: [/Certo\?/i],
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
        { turn: 1, matches: [/Entendi: axila, pernas\. Certo\?/] },
        {
          turn: 2,
          matches: [/\d{1,2}:\d{2}/],
          excludes: [/Entendi:/i, /quais zonas/i],
        },
      ],
      outboundExcludes: NO_LEAK,
    },
  },
  {
    id: 'A-44',
    title: '«íntima e perna» → eco pernas+intima (singular↔plural)',
    turnosIdeais: 2,
    // Staging Paulo 10/11/2026: catálogo «Pernas» + «Intima»; cliente «perna» + «íntima»
    // era rejeitado («Não encontrei perna») e descartava íntima.
    prepare: withIntimaZones,
    turns: [
      { role: 'client', text: 'Quero depilação feminina' },
      {
        role: 'client',
        text: 'Gostaria de agendar um horário para depilação íntima e perna',
      },
    ],
    expect: {
      proposal: false,
      noAppointment: true,
      turns: [
        { turn: 0, matches: [/quais zonas/i] },
        {
          turn: 1,
          matches: [/Entendi:.*(intima|íntima).*(pernas)|Entendi:.*(pernas).*(intima|íntima)/i, /Certo\?/],
          excludes: [/Não encontrei/i, /Não encontrei perna/i],
        },
      ],
      outboundExcludes: NO_LEAK,
    },
  },
  {
    id: 'A-45',
    title: '«por favor» não ecoa «favor» no miss de catálogo',
    turnosIdeais: 1,
    // Staging Paulo 10/11/2026: «… por favor» → «Não entendi bem «favor»».
    turns: [
      {
        role: 'client',
        text: 'Boa tarde Gostaria agendar um horário dia 13/11 por favor',
      },
    ],
    expect: {
      proposal: false,
      noAppointment: true,
      turns: [
        {
          turn: 0,
          matches: [/serviço|opções|Temos/i],
          excludes: [/«favor»/i, /Não encontrei favor/i],
        },
      ],
      outboundExcludes: NO_LEAK,
    },
  },
  {
    id: 'A-46',
    title: '«seria depilação…» não ecoa «seria» como zona',
    turnosIdeais: 2,
    // Staging Paulo 10/11/2026: «Seria depilação feminina, … e pernas» → «Não encontrei seria».
    prepare: withIntimaZones,
    turns: [
      { role: 'client', text: 'Quero depilação feminina' },
      { role: 'client', text: 'Seria depilação feminina, íntima e pernas' },
    ],
    expect: {
      proposal: false,
      noAppointment: true,
      turns: [
        { turn: 0, matches: [/quais zonas/i] },
        {
          turn: 1,
          matches: [/Entendi:.*(intima|íntima).*(pernas)|Entendi:.*(pernas).*(intima|íntima)/i, /Certo\?/],
          excludes: [/Não encontrei seria/i, /«seria»/i],
        },
      ],
      outboundExcludes: NO_LEAK,
    },
  },
  {
    id: 'A-50',
    title: '«gostaria de saber… íntima e pernas» não ecoa «saber»',
    turnosIdeais: 2,
    // Staging: mensagem longa pediu depilação masculina íntima e pernas;
    // «saber» de «gostaria de saber» → «Não encontrei saber nas opções» com zonas certas.
    prepare: withMasculineIntimaZones,
    turns: [
      { role: 'client', text: 'Quero depilação masculina' },
      {
        role: 'client',
        text: 'Gostaria de saber se faz depilação masculina íntima e pernas',
      },
    ],
    expect: {
      proposal: false,
      noAppointment: true,
      turns: [
        { turn: 0, matches: [/quais zonas/i] },
        {
          turn: 1,
          matches: [/Entendi:.*(intima|íntima).*(pernas)|Entendi:.*(pernas).*(intima|íntima)/i, /Certo\?/],
          excludes: [/Não encontrei saber/i, /Não encontrei faz/i, /«saber»/i],
        },
      ],
      outboundExcludes: NO_LEAK,
    },
  },
  {
    id: 'A-53',
    title: 'FAQ mid-zonas sem detalhe: não leftover (DEC-177)',
    turnosIdeais: 2,
    // Staging: «A íntima inclui anus?» → «Entendi: intima. Não encontrei inclui…».
    // Com Explicação no serviço: não usar essa frase genérica como «sim/não inclui».
    prepare: withIntimaAndServiceExplanation,
    turns: [
      { role: 'client', text: 'Quero depilação feminina' },
      { role: 'client', text: 'A íntima inclui anus?' },
    ],
    expect: {
      proposal: false,
      noAppointment: true,
      turns: [
        { turn: 0, matches: [/quais zonas/i] },
        {
          turn: 1,
          matches: [/Não tenho esse detalhe no cadastro; a equipe confirma/i],
          excludes: [
            /Não encontrei inclui/i,
            /Não encontrei anus/i,
            /Entendi:.*intima/i,
            /Certo\?/,
            /Retirada de pelos/i,
          ],
        },
      ],
      outboundExcludes: NO_LEAK,
    },
  },
  {
    id: 'A-54',
    title: 'FAQ mid-zonas com sinónimo ânus→Intima (DEC-177 camada 4)',
    turnosIdeais: 2,
    prepare: withIntimaAnusSynonym,
    turns: [
      { role: 'client', text: 'Quero depilação feminina' },
      { role: 'client', text: 'A íntima inclui anus?' },
    ],
    expect: {
      proposal: false,
      noAppointment: true,
      turns: [
        { turn: 0, matches: [/quais zonas/i] },
        {
          turn: 1,
          matches: [/faz parte de Intima/i, /quais zonas/i],
          excludes: [/Não encontrei inclui/i, /Não encontrei anus/i, /Horários/i],
        },
      ],
      outboundExcludes: NO_LEAK,
    },
  },
  {
    id: 'A-48',
    title: 'Lista Horários: uma linha no reply Meta (sem description=title)',
    turnosIdeais: 3,
    // Smoke staging: toque no horário ecoava «sexta 13/11 11:15» ×2 no bubble verde —
    // title e description iguais no payload da lista. DEC-134 A: description só se cortar.
    // Same-day (Paulo 13/11/2026): título da linha é só HH:MM; o dia vai no corpo.
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
        { turn: 1, matches: [/Entendi: axila, pernas\. Certo\?/] },
        { turn: 2, matches: [/\d{1,2}:\d{2}/] },
      ],
      outboundExcludes: NO_LEAK,
      assert: (s) => {
        const rows = s.db
          .all<{ interactive_json: string | null }>(
            `SELECT o.interactive_json AS interactive_json
             FROM outbound_messages o
             JOIN messages m ON m.id = o.message_id
             WHERE o.tenant_id = ? AND m.conversation_id = ?
             ORDER BY o.created_at`,
            s.tenantId,
            s.conversationId,
          )
          .flatMap((msg) => {
            if (!msg.interactive_json) return []
            const parsed = JSON.parse(msg.interactive_json) as {
              list?: { button?: string; sections?: Array<{ rows?: Array<{ title?: string; description?: string }> }> }
            }
            if (parsed.list?.button !== 'Horários') return []
            return parsed.list.sections?.flatMap((section) => section.rows ?? []) ?? []
          })
        if (rows.length === 0) return ['A-48: nenhuma lista Horários no outbound']
        const dupes = rows.filter(
          (row) => row.description && row.description.trim() === (row.title ?? '').trim(),
        )
        if (dupes.length > 0) {
          return [
            `A-48: ${dupes.length} linha(s) com description=title (Meta duplica no bubble): ${dupes
              .map((d) => d.title)
              .join(', ')}`,
          ]
        }
        return []
      },
    },
  },
  {
    id: 'A-53',
    title: '«Posso falar com um atendente?» na pergunta das zonas → equipe (DEC-083)',
    turnosIdeais: 2,
    // rsamp_fa7f138 (staging 13/11/2026 13:16): pedido de atendente virava
    // «Não encontrei falar nas opções» + lista de zonas em vez do handoff.
    turns: [
      { role: 'client', text: 'Quero agendar uma depilação masculina' },
      { role: 'client', text: 'Posso falar com um atendente?' },
    ],
    expect: {
      paused: true,
      proposal: false,
      noAppointment: true,
      turns: [{ turn: 0, matches: [/quais zonas/i] }],
      outboundIncludes: ['Vou pedir para a equipe continuar daqui.'],
      outboundExcludes: [/Não encontrei/i, /nas opções/i],
    },
  },
]
