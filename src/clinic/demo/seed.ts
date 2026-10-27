import type { Clock } from '../../db/clock'
import { insertSyntheticAppointment } from '../config/appointments'
import { setWeeklyWindows } from '../config/availability'
import { listResources, upsertResource } from '../config/resources'
import { listServices, upsertService } from '../config/services'
import type { ResourceRow, ServiceRow } from '../config/types'
import { upsertContact } from '../contacts'
import type { OpportunityStage } from '../constants'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import {
  createConversation,
  setConversationAssignee,
  setConversationStatus,
  touchConversationMessage,
} from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { assertClinicSchemaReady } from '../migrations'
import {
  insertOpportunity,
  insertStageHistory,
  setLinkedAppointment,
  updateOpportunityStage,
} from '../pipeline/opportunities'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import { isDemoTenantId } from './ids'

/**
 * Clínica demo de staging (backlog item 3). Dados 100% fictícios:
 * nomes PT-BR, procedimentos reais de estética, agenda da semana cheia,
 * conversas em vários estágios. Nenhum «Paulo» como paciente.
 *
 * Idempotente: recursos/serviços por nome, contatos/conversas/mensagens/
 * compromissos/oportunidades por id fixo. Correr de novo numa semana nova
 * acrescenta a agenda dessa semana (e da seguinte) sem duplicar.
 *
 * Números `55 00 …` (DDD 00 não existe) — não roteáveis; além disso o envio
 * outbound é recusado para tenants demo (ver `isDemoTenantId`).
 */

const DAY_MS = 86_400_000
const MIN_MS = 60_000
/** America/Sao_Paulo sem horário de verão desde 2019. */
const SP_OFFSET_MS = 3 * 3_600_000

export type DemoSeedResult = {
  tenantId: string
  resources: number
  services: number
  appointmentsCreated: number
  conversationsCreated: number
  opportunitiesCreated: number
}

const PROFESSIONALS = [
  { key: 'luiza', name: 'Dra. Luíza Andrade' },
  { key: 'conceicao', name: 'Conceição Ribeiro' },
  { key: 'thais', name: 'Thaís Moreira' },
] as const
type ProKey = (typeof PROFESSIONALS)[number]['key']

const ROOMS = [
  { key: 'sala1', name: 'Sala 1 — Injetáveis', category: 'consultorio' },
  { key: 'sala2', name: 'Sala 2 — Facial e corporal', category: 'estetica' },
  { key: 'laser', name: 'Sala Laser', category: 'laser' },
] as const
type RoomKey = (typeof ROOMS)[number]['key']

type ServiceSpec = {
  key: string
  name: string
  minutes: number
  buffer: number
  priceCents: number | null
  pro: ProKey
  room: RoomKey
  explanation: string
}

const SERVICES: readonly ServiceSpec[] = [
  { key: 'avaliacao', name: 'Avaliação estética', minutes: 30, buffer: 0, priceCents: 0, pro: 'luiza', room: 'sala1', explanation: 'Conversa inicial para entender seus objetivos e indicar o melhor tratamento.' },
  { key: 'toxina', name: 'Toxina botulínica (3 regiões)', minutes: 30, buffer: 15, priceCents: 120_000, pro: 'luiza', room: 'sala1', explanation: 'Testa, glabela e pés de galinha. Retorno em 15 dias incluso.' },
  { key: 'labial', name: 'Preenchimento labial', minutes: 45, buffer: 15, priceCents: 150_000, pro: 'luiza', room: 'sala1', explanation: 'Ácido hialurônico, 1 ml. Inclui anestesia tópica.' },
  { key: 'limpeza', name: 'Limpeza de pele profunda', minutes: 60, buffer: 15, priceCents: 18_000, pro: 'conceicao', room: 'sala2', explanation: 'Higienização, esfoliação, extração e máscara calmante.' },
  { key: 'peeling', name: 'Peeling químico', minutes: 45, buffer: 15, priceCents: 35_000, pro: 'conceicao', room: 'sala2', explanation: 'Renovação da pele para manchas e textura.' },
  { key: 'drenagem', name: 'Drenagem linfática', minutes: 45, buffer: 15, priceCents: 16_000, pro: 'conceicao', room: 'sala2', explanation: 'Massagem corporal para reduzir inchaço e retenção.' },
  { key: 'laser_axila', name: 'Depilação a laser — axilas', minutes: 30, buffer: 0, priceCents: 15_000, pro: 'thais', room: 'laser', explanation: 'Laser de diodo. Recomendamos de 8 a 10 sessões.' },
  { key: 'laser_perna', name: 'Depilação a laser — pernas inteiras', minutes: 45, buffer: 15, priceCents: 48_000, pro: 'thais', room: 'laser', explanation: 'Laser de diodo, pernas completas.' },
  { key: 'micro', name: 'Microagulhamento', minutes: 60, buffer: 15, priceCents: 45_000, pro: 'thais', room: 'laser', explanation: 'Estimula colágeno; indicado para cicatrizes de acne.' },
]

/** Pacientes só da agenda (rótulo do compromisso). */
const AGENDA_PATIENTS = [
  'Maria Conceição Souza', 'Ana Beatriz Gonçalves', 'Letícia Barbosa', 'Gabriela Nóbrega',
  'Patrícia Simões', 'Júlia Castro', 'Renata Magalhães', 'Camila Brandão', 'Sérgio Teixeira',
  'Vitória Assunção', 'Débora Falcão', 'Lúcia Helena Prates', 'Rafaela Guimarães',
  'Tânia Cordeiro', 'Mônica Viana', 'Isabela Lacerda', 'Cláudia Peixoto', 'Bruna Sampaio',
  'Heloísa Batista', 'Márcia Rezende', 'Joana D’Ávila', 'Priscila Antunes', 'Sônia Freitas',
  'Larissa Queiroz', 'Valéria Coutinho', 'André Luís Pacheco', 'Aline Medeiros',
]

/** Grade por profissional: [minuto do dia, serviço]. Sábado só manhã. */
const DAY_TEMPLATES: Record<ProKey, Array<[number, string]>> = {
  luiza: [[540, 'avaliacao'], [585, 'toxina'], [645, 'labial'], [720, 'toxina'], [840, 'avaliacao'], [885, 'labial'], [960, 'toxina'], [1020, 'avaliacao']],
  conceicao: [[540, 'limpeza'], [615, 'peeling'], [690, 'drenagem'], [840, 'limpeza'], [915, 'drenagem'], [990, 'peeling'], [1050, 'drenagem']],
  thais: [[540, 'laser_axila'], [570, 'laser_perna'], [630, 'micro'], [720, 'laser_axila'], [840, 'micro'], [915, 'laser_perna'], [975, 'laser_axila'], [1005, 'micro']],
}

type ConvSpec = {
  key: string
  name: string
  waSuffix: string
  status: 'new' | 'open' | 'closed'
  assignee: 'owner' | 'camila' | null
  stage: OpportunityStage
  /** [minutos atrás, direção, texto] — da mais antiga para a mais recente. */
  messages: Array<[number, 'inbound' | 'outbound', string]>
  unread: number
  /** Compromisso vinculado: [dia relativo à hoje, minuto, serviço]. */
  appointment?: [number, number, string]
}

const CONVERSATIONS: readonly ConvSpec[] = [
  {
    key: 'conceicao', name: 'Maria Conceição Souza', waSuffix: '01', status: 'new', assignee: null,
    stage: 'novo_contato', unread: 2,
    messages: [
      [14, 'inbound', 'Boa tarde! Vi o perfil de vocês no Instagram 😊'],
      [12, 'inbound', 'Quanto custa a limpeza de pele? Tenho a pele bem oleosa.'],
    ],
  },
  {
    key: 'joao', name: 'João Pedro Almeida', waSuffix: '02', status: 'new', assignee: null,
    stage: 'novo_contato', unread: 1,
    messages: [[38, 'inbound', 'Olá, vocês fazem depilação a laser masculina? Seria nas costas.']],
  },
  {
    key: 'luiza', name: 'Luíza Fernandes', waSuffix: '03', status: 'open', assignee: 'owner',
    stage: 'em_atendimento', unread: 1,
    messages: [
      [95, 'inbound', 'Oi! Queria saber sobre o preenchimento labial.'],
      [90, 'outbound', 'Oi, Luíza! O preenchimento labial com ácido hialurônico (1 ml) é R$ 1.500 e leva cerca de 45 minutos.'],
      [88, 'outbound', 'Quer agendar uma avaliação gratuita com a Dra. Luíza Andrade antes?'],
      [6, 'inbound', 'Quero sim! Tem horário na quinta à tarde?'],
    ],
  },
  {
    key: 'fernanda', name: 'Fernanda Araújo', waSuffix: '04', status: 'open', assignee: 'owner',
    stage: 'horario_proposto', unread: 0,
    messages: [
      [240, 'inbound', 'Bom dia! Preciso remarcar minha drenagem de amanhã.'],
      [232, 'outbound', 'Bom dia, Fernanda! Sem problemas. Tenho sexta às 15h ou sábado às 10h30, qual fica melhor?'],
      [225, 'inbound', 'Deixa eu ver com meu trabalho e já te falo.'],
    ],
  },
  {
    key: 'beatriz', name: 'Ana Beatriz Gonçalves', waSuffix: '05', status: 'open', assignee: 'camila',
    stage: 'agendado', unread: 0, appointment: [1, 585, 'toxina'],
    messages: [
      [1440, 'inbound', 'Oi, gostaria de agendar a toxina botulínica.'],
      [1430, 'outbound', 'Oi, Ana Beatriz! Temos amanhã às 9h45 com a Dra. Luíza Andrade. Posso confirmar?'],
      [1425, 'inbound', 'Pode sim, obrigada!'],
      [1420, 'outbound', 'Confirmado! Toxina botulínica amanhã às 9h45. Chegue 10 minutos antes 💜'],
    ],
  },
  {
    key: 'leticia', name: 'Letícia Barbosa', waSuffix: '06', status: 'open', assignee: 'camila',
    stage: 'agendado', unread: 0, appointment: [2, 840, 'limpeza'],
    messages: [
      [300, 'inbound', 'Consigo fazer limpeza de pele depois de amanhã à tarde?'],
      [290, 'outbound', 'Consegue sim! Às 14h com a Conceição Ribeiro, tudo bem?'],
      [280, 'inbound', 'Perfeito 👍'],
    ],
  },
  {
    key: 'gabriela', name: 'Gabriela Nóbrega', waSuffix: '07', status: 'open', assignee: 'owner',
    stage: 'em_atendimento', unread: 0,
    messages: [
      [600, 'inbound', 'Quero fechar o pacote de laser nas pernas, mas ainda não sei o dia.'],
      [590, 'outbound', 'Claro, Gabriela! Deixo reservado o pacote e combinamos a data quando você puder.'],
    ],
  },
  {
    key: 'sergio', name: 'Sérgio Teixeira', waSuffix: '08', status: 'open', assignee: 'owner',
    stage: 'em_atendimento', unread: 1,
    messages: [
      [70, 'inbound', 'Boa tarde. O microagulhamento ajuda com cicatriz de acne?'],
      [65, 'outbound', 'Boa tarde, Sérgio! Ajuda bastante, sim. Normalmente indicamos de 3 a 4 sessões.'],
      [3, 'inbound', 'E qual o valor da sessão?'],
    ],
  },
  {
    key: 'tania', name: 'Tânia Cordeiro', waSuffix: '09', status: 'closed', assignee: 'camila',
    stage: 'concluido', unread: 0,
    messages: [
      [2880, 'inbound', 'Amei o resultado do peeling! Obrigada, Conceição.'],
      [2870, 'outbound', 'Que bom, Tânia! Lembre-se do protetor solar todos os dias ☀️'],
    ],
  },
  {
    key: 'monica', name: 'Mônica Viana', waSuffix: '10', status: 'closed', assignee: 'owner',
    stage: 'perdido', unread: 0,
    messages: [
      [4320, 'inbound', 'Achei um pouco caro, vou pensar.'],
      [4310, 'outbound', 'Tudo bem, Mônica! Se quiser, temos condições em até 3x sem juros.'],
    ],
  },
]

const CAMILA = { id: 'user_demo_camila', name: 'Camila (recepção)' }

function spDayIndex(ms: number): number {
  return Math.floor((ms - SP_OFFSET_MS) / DAY_MS)
}
/** 0 = domingo … 6 = sábado (1970-01-01 foi quinta). */
function dayOfWeek(dayIndex: number): number {
  return (((dayIndex + 4) % 7) + 7) % 7
}
function spDayMinuteToUtc(dayIndex: number, minute: number): number {
  return dayIndex * DAY_MS + minute * MIN_MS + SP_OFFSET_MS
}
function ymd(dayIndex: number): string {
  return new Date(dayIndex * DAY_MS).toISOString().slice(0, 10).replaceAll('-', '')
}

function ensureResource(
  db: ClinicDb,
  tenantId: string,
  existing: ResourceRow[],
  spec: { kind: 'professional' | 'room'; name: string; category?: string },
  clock: Clock,
): ResourceRow {
  const found = existing.find((r) => r.kind === spec.kind && r.name === spec.name)
  if (found) return found
  return upsertResource(
    db,
    tenantId,
    { kind: spec.kind, name: spec.name, category: spec.category ?? null, active: true },
    clock,
  )
}

export function seedDemoClinicOp(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
  opts: { ownerClerkUserId: string; ownerDisplayName?: string },
): DemoSeedResult {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  if (!isDemoTenantId(caller.tenantId)) {
    throw new Error('demo seed só para tenants demo')
  }
  const meta = bindOrAssertTenant(db, caller, clock)
  const tenantId = meta.tenantId
  const owner = { id: opts.ownerClerkUserId, name: opts.ownerDisplayName ?? 'Você' }

  return db.transactionSync(() => {
    const t0 = clock.nowMs()
    const existingRes = listResources(db, tenantId, clock)

    const pros = new Map<ProKey, ResourceRow>()
    for (const p of PROFESSIONALS) {
      pros.set(p.key, ensureResource(db, tenantId, existingRes, { kind: 'professional', name: p.name }, clock))
    }
    const rooms = new Map<RoomKey, ResourceRow>()
    for (const r of ROOMS) {
      rooms.set(r.key, ensureResource(db, tenantId, existingRes, { kind: 'room', name: r.name, category: r.category }, clock))
    }

    // Horários: seg–sex 9h–19h, sáb 9h–13h (profissionais e salas).
    const windows = [1, 2, 3, 4, 5]
      .map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1140 }))
      .concat([{ dayOfWeek: 6, startMinute: 540, endMinute: 780 }])
    for (const r of [...pros.values(), ...rooms.values()]) {
      setWeeklyWindows(db, tenantId, { resourceId: r.id, windows }, clock)
    }

    const existingSvc = listServices(db, tenantId)
    const services = new Map<string, ServiceRow>()
    for (const s of SERVICES) {
      const found = existingSvc.find((x) => x.name === s.name)
      services.set(
        s.key,
        found ??
          upsertService(
            db,
            tenantId,
            {
              name: s.name,
              durationMinutes: s.minutes,
              bufferMinutes: s.buffer,
              priceCents: s.priceCents,
              clientExplanation: s.explanation,
              active: true,
              professionalIds: [pros.get(s.pro)!.id],
              roomRequirement: { mode: 'resource', resourceId: rooms.get(s.room)!.id },
            },
            clock,
          ),
      )
    }
    const specByKey = new Map(SERVICES.map((s) => [s.key, s]))

    const aptExists = (id: string) =>
      !!db.get<{ id: string }>(`SELECT id FROM appointments WHERE tenant_id = ? AND id = ?`, tenantId, id)

    let appointmentsCreated = 0
    const today = spDayIndex(t0)
    const monday = today - ((dayOfWeek(today) + 6) % 7)

    // Compromissos das conversas (vinculados) — reservam o slot primeiro.
    const linked = new Map<string, string>()
    const takenSlots = new Set<string>()
    for (const c of CONVERSATIONS) {
      if (!c.appointment) continue
      const [rel, minute, svcKey] = c.appointment
      let day = today + rel
      while (dayOfWeek(day) === 0) day += 1
      const spec = specByKey.get(svcKey)!
      const id = `apt_demo_${ymd(day)}_${spec.pro}_${minute}`
      takenSlots.add(id)
      linked.set(c.key, id)
      if (!aptExists(id)) {
        const startsAt = spDayMinuteToUtc(day, minute)
        insertSyntheticAppointment(
          db,
          tenantId,
          {
            id,
            serviceId: services.get(svcKey)!.id,
            professionalId: pros.get(spec.pro)!.id,
            roomResourceId: rooms.get(spec.room)!.id,
            startsAt,
            endsAt: startsAt + spec.minutes * MIN_MS,
            contactLabel: c.name,
            status: 'confirmed',
          },
          clock,
        )
        appointmentsCreated += 1
      }
    }

    // Agenda cheia: semana atual + próxima (seg–sáb), ~85% ocupada.
    let patientIdx = 0
    for (let d = monday; d < monday + 14; d++) {
      const dow = dayOfWeek(d)
      if (dow === 0) continue
      for (const p of PROFESSIONALS) {
        for (const [i, [minute, svcKey]] of DAY_TEMPLATES[p.key].entries()) {
          if (dow === 6 && minute >= 720) continue
          if ((d * 7 + i * 3 + p.key.length) % 7 === 0) continue // folgas na grade
          const spec = specByKey.get(svcKey)!
          const id = `apt_demo_${ymd(d)}_${p.key}_${minute}`
          patientIdx += 1
          if (takenSlots.has(id) || aptExists(id)) continue
          const startsAt = spDayMinuteToUtc(d, minute)
          insertSyntheticAppointment(
            db,
            tenantId,
            {
              id,
              serviceId: services.get(svcKey)!.id,
              professionalId: pros.get(p.key)!.id,
              roomResourceId: rooms.get(spec.room)!.id,
              startsAt,
              endsAt: startsAt + spec.minutes * MIN_MS,
              contactLabel: AGENDA_PATIENTS[(patientIdx * 5 + d) % AGENDA_PATIENTS.length]!,
              status: 'confirmed',
            },
            clock,
          )
          appointmentsCreated += 1
        }
      }
    }

    // Inbox + Acompanhamento.
    let conversationsCreated = 0
    let opportunitiesCreated = 0
    for (const c of CONVERSATIONS) {
      const cnvId = `cnv_demo_${c.key}`
      if (db.get<{ id: string }>(`SELECT id FROM conversations WHERE tenant_id = ? AND id = ?`, tenantId, cnvId)) {
        continue
      }
      const contact = upsertContact(
        db,
        { tenantId, waId: `55000000000${c.waSuffix}`, displayName: c.name, id: `ctc_demo_${c.key}` },
        clock,
      )
      createConversation(db, { tenantId, contactId: contact.id, status: 'new', id: cnvId }, clock)
      const who = c.assignee === 'owner' ? owner : c.assignee === 'camila' ? CAMILA : null
      if (who) {
        setConversationAssignee(db, {
          tenantId,
          conversationId: cnvId,
          assigneeClerkUserId: who.id,
          assigneeDisplayName: who.name,
          updatedAt: t0 - c.messages[0]![0] * MIN_MS,
        })
      }
      const inboundCount = c.messages.filter((m) => m[1] === 'inbound').length
      let inboundSeen = 0
      for (const [i, [ago, direction, body]] of c.messages.entries()) {
        const at = t0 - ago * MIN_MS
        insertMessage(
          db,
          {
            tenantId,
            conversationId: cnvId,
            direction,
            body,
            externalMessageId: `demo:${c.key}:${i}`,
            deliveryState: direction === 'inbound' ? 'received' : 'read',
            authorClerkUserId: direction === 'outbound' ? (who?.id ?? owner.id) : null,
            authorDisplayName: direction === 'outbound' ? (who?.name ?? owner.name) : null,
            createdAt: at,
            id: `msg_demo_${c.key}_${i}`,
          },
          clock,
        )
        if (direction === 'inbound') inboundSeen += 1
        touchConversationMessage(db, {
          tenantId,
          conversationId: cnvId,
          preview: body,
          direction,
          at,
          bumpUnread: direction === 'inbound' && inboundCount - inboundSeen < c.unread,
          reopenIfClosed: false,
        })
      }
      if (c.status === 'closed') {
        setConversationStatus(db, { tenantId, conversationId: cnvId, status: 'closed', updatedAt: t0 })
      }
      conversationsCreated += 1

      const oppId = `opp_demo_${c.key}`
      const lastAt = t0 - c.messages[c.messages.length - 1]![0] * MIN_MS
      insertOpportunity(
        db,
        {
          id: oppId,
          tenantId,
          contactId: contact.id,
          conversationId: cnvId,
          stage: 'novo_contato',
          cycleNumber: 1,
          assigneeClerkUserId: who?.id ?? null,
          assigneeDisplayName: who?.name ?? null,
          lastInteractionAt: lastAt,
        },
        clock,
      )
      insertStageHistory(
        db,
        { tenantId, opportunityId: oppId, fromStage: null, toStage: 'novo_contato', createdAt: t0 - c.messages[0]![0] * MIN_MS },
        clock,
      )
      if (c.stage !== 'novo_contato') {
        const closed = c.stage === 'concluido' || c.stage === 'perdido'
        updateOpportunityStage(db, {
          tenantId,
          opportunityId: oppId,
          stage: c.stage,
          status: closed ? 'closed' : 'open',
          updatedAt: lastAt,
          lastInteractionAt: lastAt,
        })
        insertStageHistory(
          db,
          {
            tenantId,
            opportunityId: oppId,
            fromStage: 'novo_contato',
            toStage: c.stage,
            actorClerkUserId: who?.id ?? owner.id,
            actorDisplayName: who?.name ?? owner.name,
            createdAt: lastAt,
          },
          clock,
        )
      }
      const aptId = linked.get(c.key)
      if (aptId) {
        setLinkedAppointment(db, { tenantId, opportunityId: oppId, appointmentId: aptId, updatedAt: t0 })
        db.run(
          `UPDATE appointments SET opportunity_id = ?, contact_id = ?, conversation_id = ?
           WHERE tenant_id = ? AND id = ?`,
          oppId,
          contact.id,
          cnvId,
          tenantId,
          aptId,
        )
      }
      opportunitiesCreated += 1
    }

    return {
      tenantId,
      resources: pros.size + rooms.size,
      services: services.size,
      appointmentsCreated,
      conversationsCreated,
      opportunitiesCreated,
    }
  })
}
