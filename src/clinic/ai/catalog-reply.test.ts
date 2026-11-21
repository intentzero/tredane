/** Respostas de catálogo sem modelo: almoço, duração, quem faz, zona (sem sala/buffer ao cliente). */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { listResources, listServices, replaceServiceZonesOp, setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { upsertKnowledgeCategory, upsertKnowledgeEntry } from '../config/knowledge'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage, listMessages } from '../inbox/messages'
import { setAiProfileOp } from '../config'
import { bootClinicDb } from '../test-db'
import { catalogReply } from './catalog-reply'
import { LOCATION_MAP_OFFER_BODIES } from './location-map-offer'
import { formatOpeningHours } from './schedule-context'
import { handoffReason } from './human-handoff'
import {
  clearScheduleSession,
  getScheduleSession,
  saveScheduleSession,
  scheduleFactsFromText,
} from './schedule-session'

const NOW = Date.UTC(2026, 9, 30, 21, 0)

function catalogTurn(
  db: import('../store').ClinicDb,
  tenantId: string,
  turnText: string,
  clock: import('../../db/clock').Clock,
  conversationId?: string,
) {
  const messages =
    conversationId != null
      ? listMessages(db, tenantId, { conversationId, limit: 40 }).messages.map((message) => ({
          direction: message.direction,
          body: message.body,
          createdAt: message.createdAt,
        }))
      : []
  return {
    turnText,
    messages,
    catalog: {
      services: listServices(db, tenantId).filter((service) => service.active),
      resources: listResources(db, tenantId, clock),
    },
    session: null as ReturnType<typeof getScheduleSession>,
  }
}

describe('catalogReply', () => {
  it('«Onde atendem?» e «onde fica?» usam corpo opção B sem URL (DEC-211)', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const tenantId = 'clinic-demo-a'
    const caller = workerCaller(tenantId)
    setAiProfileOp(
      boot.db,
      caller,
      { googleBusinessUrl: 'https://maps.app.goo.gl/clinica-demo' },
      clock,
    )
    for (const ask of ['Onde fica a clínica?', 'Onde atendem?', 'onde vocês ficam?', 'onde é?']) {
      const reply = catalogReply(boot.db, tenantId, ask, clock, { conversationId: 'cnv_loc' })
      expect(reply, ask).toBeTruthy()
      expect(LOCATION_MAP_OFFER_BODIES, ask).toContain(reply)
      expect(reply, ask).not.toMatch(/https?:\/\//i)
    }
    // Expediente com dia continua FAQ de horário, não mapa.
    expect(catalogReply(boot.db, tenantId, 'vocês atendem domingo?', clock)).not.toBeNull()
    expect(catalogReply(boot.db, tenantId, 'vocês atendem domingo?', clock)).not.toMatch(/mapa/i)
  })

  it('mantém o vão do almoço e responde preço e quem faz (sem sala nem buffer)', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const tenantId = 'clinic-demo-a'
    const caller = workerCaller(tenantId)
    const room = upsertResourceOp(boot.db, caller, { kind: 'room', name: 'Sala Depilação', category: 'Sala' }, clock)
    const gi = upsertResourceOp(boot.db, caller, { kind: 'professional', name: 'Gi' }, clock)
    const sandra = upsertResourceOp(boot.db, caller, { kind: 'professional', name: 'Sandra' }, clock)
    const svc = upsertServiceOp(
      boot.db,
      caller,
      {
        name: 'Depilação',
        durationMinutes: 15,
        bufferMinutes: 15,
        priceCents: 5000,
        variantKind: 'Zona',
        variantKindPlural: 'Zonas',
        professionalIds: [gi.id],
        roomRequirement: { mode: 'rooms', resourceIds: [room.id] },
      },
      clock,
    )
    replaceServiceZonesOp(
      boot.db,
      caller,
      svc.id,
      [
        { name: 'Axila masculina', durationMinutes: 15, priceCents: 5000, audience: 'masculino' },
        { name: 'Pernas masculinas', durationMinutes: 30, priceCents: 14000, audience: 'masculino' },
      ],
      clock,
    )
    setWeeklyWindowsOp(
      boot.db,
      caller,
      {
        resourceId: gi.id,
        windows: [1, 2, 3, 4, 5].flatMap((d) => [
          { dayOfWeek: d, startMinute: 9 * 60, endMinute: 12 * 60 },
          { dayOfWeek: d, startMinute: 13 * 60, endMinute: 18 * 60 },
        ]),
      },
      clock,
    )
    const hours = formatOpeningHours([
      { dayOfWeek: 1, startMinute: 9 * 60, endMinute: 12 * 60 },
      { dayOfWeek: 1, startMinute: 13 * 60, endMinute: 18 * 60 },
    ])
    expect(hours[0]).toBe('segunda: 09:00–12:00 e 13:00–18:00')
    const open = catalogReply(boot.db, tenantId, 'Qual o horário de funcionamento da clínica?', clock)
    expect(open).toContain('09:00–12:00 e 13:00–18:00')
    expect(open).not.toContain('09:00–18:00')
    // Lab Bloco B: FAQ de expediente, não DEC-151 «Não entendi «depois»» + lista.
    const evening = catalogReply(boot.db, tenantId, 'tem horário depois das 20h?', clock)
    expect(evening).toContain('09:00–12:00 e 13:00–18:00')
    expect(evening).not.toMatch(/n[aã]o entendi/i)
    expect(evening).not.toMatch(/Quer ver as op[cç][oõ]es/i)

    expect(catalogReply(boot.db, tenantId, 'Quanto custa a axila masculina e quanto tempo dura?', clock)).toBe(
      'Axila masculina custa R$ 50,00 e dura 15 min.',
    )
    const who = catalogReply(boot.db, tenantId, 'Quem faz a depilação e em qual sala?', clock)
    expect(who).toContain('Gi')
    expect(who).not.toContain('Sala Depilação')
    expect(who).not.toMatch(/\bsala\b/i)
    expect(catalogReply(boot.db, tenantId, 'Quero depilação amanhã à tarde.', clock)).toMatch(/quais zonas/i)
    expect(catalogReply(boot.db, tenantId, 'Quero depilação amanhã à tarde.', clock)).not.toMatch(/13:00/)
    const both = catalogReply(
      boot.db,
      tenantId,
      'Se eu fizer axila masculina e pernas masculinas juntas, qual o preço e a duração?',
      clock,
    )
    expect(both).toMatch(/R\$\s*190,00/)
    expect(both).toMatch(/45 min/)
    expect(both).toMatch(/No total|Somando tudo/)
    expect(both).not.toMatch(/intervalo|ocupa a agenda|buffer|Juntas/i)
    expect(handoffReason(boot.db, tenantId, 'Quero marcar com a Sandra.', clock)).toBe('human_only')
    expect(handoffReason(boot.db, tenantId, 'Quero com a Gi.', clock)).toBeNull()
    void sandra
    boot.close()
  })

  it('E-01: preço de serviço sem variantes inclui duração (#413)', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const tenantId = 'clinic-demo-a'
    const caller = workerCaller(tenantId)
    upsertServiceOp(
      boot.db,
      caller,
      {
        name: 'Limpeza de pele',
        durationMinutes: 60,
        bufferMinutes: 0,
        priceCents: 18000,
        professionalIds: [],
        roomRequirement: { mode: 'none' },
      },
      clock,
    )
    const reply = catalogReply(boot.db, tenantId, 'Quanto custa a limpeza de pele?', clock)
    expect(reply).toMatch(/R\$\s*180,00/)
    expect(reply).toMatch(/60 min/)
    expect(reply).toMatch(/horários/i)
    boot.close()
  })
})

describe('linha antes das zonas (DEC-078 / DEC-075)', () => {
  // Fixtures de histórico (outbound simulado) — não têm de igualar a redação do catálogo.
  const LINE = 'Depilação feminina ou masculina?'
  const ZONES = 'Para Depilação, quais zonas você quer? Temos Axila, Pernas.'
  const LINE_RE = /feminina ou masculina/i
  const ZONES_RE = /quais zonas|Axila.*Pernas|Pernas.*Axila/i

  function seedMixed() {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const tenantId = 'clinic-demo-a'
    const caller = workerCaller(tenantId)
    const svc = upsertServiceOp(
      boot.db,
      caller,
      {
        name: 'Depilação',
        durationMinutes: 30,
        bufferMinutes: 15,
        priceCents: 5000,
        variantKind: 'Zona',
        variantKindPlural: 'Zonas',
        professionalIds: [],
        roomRequirement: { mode: 'none' },
      },
      clock,
    )
    replaceServiceZonesOp(
      boot.db,
      caller,
      svc.id,
      [
        { name: 'Axila', durationMinutes: 15, priceCents: 5_000, audience: 'feminino' },
        { name: 'Axila', durationMinutes: 20, priceCents: 8_000, audience: 'masculino' },
        { name: 'Pernas', durationMinutes: 30, priceCents: 14_000, audience: 'feminino' },
        { name: 'Pernas', durationMinutes: 40, priceCents: 18_000, audience: 'masculino' },
      ],
      clock,
    )
    const contact = upsertContact(
      boot.db,
      { tenantId, waId: '5511900000075', displayName: 'Paulo' },
      clock,
    )
    const conversation = createConversation(boot.db, { tenantId, contactId: contact.id }, clock)
    return { ...boot, clock, tenantId, caller, svc, contact, conversation }
  }

  it('pergunta a linha e depois lista Axila e Pernas só dessa linha', () => {
    const boot = seedMixed()
    try {
      const opts = { conversationId: boot.conversation.id }
      expect(catalogReply(boot.db, boot.tenantId, 'Quero depilação amanhã à tarde.', boot.clock, opts)).toMatch(LINE_RE)
      expect(getScheduleSession(boot.db, boot.tenantId, boot.conversation.id)).toMatchObject({
        serviceId: boot.svc.id,
        audienceLine: null,
      })
      // lineOnly cede ao autoBook (Opções); grava a linha e devolve null.
      expect(catalogReply(boot.db, boot.tenantId, 'Feminina', boot.clock, opts)).toBeNull()
      expect(getScheduleSession(boot.db, boot.tenantId, boot.conversation.id)?.audienceLine).toBe('feminino')
      expect(catalogReply(boot.db, boot.tenantId, 'Masculina', boot.clock, opts)).toBeNull()
      expect(getScheduleSession(boot.db, boot.tenantId, boot.conversation.id)?.audienceLine).toBe('masculino')
      expect(
        catalogReply(boot.db, boot.tenantId, 'Quanto custa a axila da depilação feminina?', boot.clock, opts),
      ).toMatch(/Axila.*R\$\s*50,00.*15 min/)
      expect(
        catalogReply(boot.db, boot.tenantId, 'Quanto custa a axila da depilação masculina?', boot.clock, opts),
      ).toMatch(/Axila.*R\$\s*80,00.*20 min/)
      expect(
        boot.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM appointments WHERE tenant_id = ?`, boot.tenantId)?.n,
      ).toBe(0)
    } finally {
      boot.close()
    }
  })

  it('serviço só feminino não pergunta a linha e não repete o nome', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    try {
      const tenantId = 'clinic-demo-a'
      const caller = workerCaller(tenantId)
      const svc = upsertServiceOp(
        boot.db,
        caller,
        {
          name: 'Depilação',
          durationMinutes: 30,
          bufferMinutes: 15,
          priceCents: 5000,
          variantKind: 'Zona',
          variantKindPlural: 'Zonas',
          professionalIds: [],
          roomRequirement: { mode: 'none' },
        },
        clock,
      )
      replaceServiceZonesOp(
        boot.db,
        caller,
        svc.id,
        [
          { name: 'Axila', durationMinutes: 15, priceCents: 5_000, audience: 'feminino' },
          { name: 'Pernas', durationMinutes: 30, priceCents: 14_000, audience: 'feminino' },
          { name: 'Pernas', durationMinutes: 45, priceCents: 16_000, audience: 'feminino' },
        ],
        clock,
      )
      const reply = catalogReply(boot.db, tenantId, 'Quero depilação amanhã à tarde.', clock)
      expect(reply).toMatch(/quais zonas|axila/i)
      expect(reply).toMatch(/pernas \(feminino, 30 min\)/)
      expect(reply).toMatch(/pernas \(feminino, 45 min\)/)
      expect(reply).not.toMatch(/Pernas \(feminino/)
      expect(reply).not.toMatch(/feminina ou masculina/i)
      expect(reply).not.toMatch(/^oi|^ol[aá]/i)
    } finally {
      boot.close()
    }
  })

  it('o nome Paulo não escolhe a linha masculina', () => {
    const boot = seedMixed()
    try {
      let t = NOW - 60_000
      const say = (direction: 'inbound' | 'outbound', body: string) => {
        insertMessage(
          boot.db,
          {
            tenantId: boot.tenantId,
            conversationId: boot.conversation.id,
            direction,
            body,
            deliveryState: direction === 'inbound' ? 'received' : 'delivered',
            createdAt: t,
          },
          boot.clock,
        )
        t += 1_000
      }
      say('inbound', 'quero o masculino')
      say('outbound', 'Posso ajudar com o horário.')
      say('inbound', 'Oi, sou o Paulo. Quero depilação amanhã à tarde.')
      const reply = catalogReply(
        boot.db,
        boot.tenantId,
        'Oi, sou o Paulo. Quero depilação amanhã à tarde.',
        boot.clock,
        { conversationId: boot.conversation.id },
      )
      expect(reply).toMatch(LINE_RE)
      expect(reply).not.toMatch(/^oi|^ol[aá]/i)
      expect(reply).not.toContain('Temos Axila')
      expect(getScheduleSession(boot.db, boot.tenantId, boot.conversation.id)?.audienceLine).toBeNull()
      expect(
        boot.db.get<{ display_name: string }>(`SELECT display_name FROM contacts WHERE id = ?`, boot.contact.id)
          ?.display_name,
      ).toBe('Paulo')
      const columns = boot.db.all<{ name: string }>(`PRAGMA table_info(contacts)`).map((column) => column.name)
      expect(columns).not.toContain('sexo')
      expect(columns).not.toContain('sex')
      expect(columns).not.toContain('gender')
    } finally {
      boot.close()
    }
  })

  it('«Quero depilação na segunda à tarde.» pergunta a linha e guarda data absoluta + tarde (#472)', () => {
    const boot = seedMixed()
    try {
      const opts = { conversationId: boot.conversation.id }
      expect(catalogReply(boot.db, boot.tenantId, 'Quero depilação na segunda à tarde.', boot.clock, opts)).toMatch(LINE_RE)
      const session1 = getScheduleSession(boot.db, boot.tenantId, boot.conversation.id)
      expect(session1).toMatchObject({
        serviceId: boot.svc.id,
        audienceLine: null,
        dayLabel: null,
        period: 'tarde',
      })
      const date1 = boot.db.get<{ date: string | null }>(
        `SELECT date FROM schedule_sessions WHERE tenant_id = ? AND conversation_id = ?`,
        boot.tenantId,
        boot.conversation.id,
      )?.date
      expect(date1).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(catalogReply(boot.db, boot.tenantId, 'Feminina', boot.clock, opts)).toBeNull()
      expect(getScheduleSession(boot.db, boot.tenantId, boot.conversation.id)).toMatchObject({
        serviceId: boot.svc.id,
        audienceLine: 'feminino',
        dayLabel: null,
        period: 'tarde',
      })
      expect(
        catalogReply(boot.db, boot.tenantId, 'Quero depilação feminina na segunda à tarde.', boot.clock, opts),
      ).toMatch(ZONES_RE)
      const columns = boot.db.all<{ name: string }>(`PRAGMA table_info(contacts)`).map((column) => column.name)
      expect(columns).not.toContain('sexo')
      expect(columns).not.toContain('sex')
      expect(columns).not.toContain('gender')
    } finally {
      boot.close()
    }
  })

  it('não pergunta a linha antes de o serviço entrar na conversa', () => {
    const boot = seedMixed()
    try {
      const opts = { conversationId: boot.conversation.id }
      expect(catalogReply(boot.db, boot.tenantId, 'Oi', boot.clock, opts)).toBeNull()
      expect(getScheduleSession(boot.db, boot.tenantId, boot.conversation.id)).toBeNull()
      expect(catalogReply(boot.db, boot.tenantId, 'amanhã à tarde', boot.clock, opts)).toBeNull()
      expect(getScheduleSession(boot.db, boot.tenantId, boot.conversation.id)).toBeNull()
      expect(scheduleFactsFromText('pode ser mais tarde')).toEqual({})
      expect(scheduleFactsFromText('Boa tarde')).toEqual({})
      expect(scheduleFactsFromText('Boa noite, quero marcar')).toEqual({})
      expect(scheduleFactsFromText('segunda ou terça à tarde')).toEqual({ period: 'tarde' })
      expect(scheduleFactsFromText('Quero depilação na segunda à tarde.')).toEqual({
        dayLabel: 'segunda',
        period: 'tarde',
      })
    } finally {
      boot.close()
    }
  })

  it('«Masculina» com zonas já ditas não repergunta zonas (DEC-090)', () => {
    const boot = seedMixed()
    try {
      const opts = { conversationId: boot.conversation.id }
      // Abre a sessão com o serviço (como a pergunta de linha).
      expect(catalogReply(boot.db, boot.tenantId, 'Quero depilação amanhã à tarde.', boot.clock, opts)).toMatch(LINE_RE)
      const say = (direction: 'inbound' | 'outbound', body: string) => {
        boot.clock.advance(1_000)
        insertMessage(
          boot.db,
          {
            tenantId: boot.tenantId,
            conversationId: boot.conversation.id,
            direction,
            body,
            deliveryState: direction === 'inbound' ? 'received' : 'delivered',
            createdAt: boot.clock.nowMs(),
          },
          boot.clock,
        )
      }
      say('inbound', 'Quero depilação amanhã à tarde.')
      say('outbound', LINE)
      say('inbound', 'Masculina')
      say('outbound', ZONES)
      say('inbound', 'Todas')
      say('outbound', 'Tenho quarta às 14:00 para pernas e axila.')
      // Repergunta errada da linha após «As 14»: não listar zonas de novo.
      expect(catalogReply(boot.db, boot.tenantId, 'Masculina', boot.clock, opts)).toBeNull()
      expect(getScheduleSession(boot.db, boot.tenantId, boot.conversation.id)?.audienceLine).toBe('masculino')
    } finally {
      boot.close()
    }
  })

  it('após limpar a sessão (DEC-086) «Todas» antiga não salta a pergunta de zonas', () => {
    const boot = seedMixed()
    try {
      const opts = { conversationId: boot.conversation.id }
      expect(catalogReply(boot.db, boot.tenantId, 'Quero depilação amanhã à tarde.', boot.clock, opts)).toMatch(LINE_RE)
      const say = (direction: 'inbound' | 'outbound', body: string) => {
        boot.clock.advance(1_000)
        insertMessage(
          boot.db,
          {
            tenantId: boot.tenantId,
            conversationId: boot.conversation.id,
            direction,
            body,
            deliveryState: direction === 'inbound' ? 'received' : 'delivered',
            createdAt: boot.clock.nowMs(),
          },
          boot.clock,
        )
      }
      say('inbound', 'Masculina')
      say('outbound', ZONES)
      say('inbound', 'Todas')
      say('outbound', 'Agendado. Quer agendar outro serviço?')
      clearScheduleSession(boot.db, boot.tenantId, boot.conversation.id)
      expect(getScheduleSession(boot.db, boot.tenantId, boot.conversation.id)).toBeNull()
      boot.clock.advance(1_000)
      // Novo funil: sem sessão, «Todas» antiga não suprime a lista de zonas.
      expect(catalogReply(boot.db, boot.tenantId, 'Quero depilação amanhã à tarde.', boot.clock, opts)).toMatch(LINE_RE)
      boot.clock.advance(1_000)
      expect(catalogReply(boot.db, boot.tenantId, 'Feminina', boot.clock, opts)).toBeNull()
      expect(getScheduleSession(boot.db, boot.tenantId, boot.conversation.id)?.audienceLine).toBe('feminino')
    } finally {
      boot.close()
    }
  })

  it('D4: pergunta de preço não grava variante no quadro', () => {
    const boot = seedMixed()
    try {
      const opts = { conversationId: boot.conversation.id }
      expect(
        catalogReply(boot.db, boot.tenantId, 'Quanto custa a axila masculina?', boot.clock, opts),
      ).toMatch(/R\$/)
      expect(getScheduleSession(boot.db, boot.tenantId, boot.conversation.id)?.variantIds).toBeFalsy()
    } finally {
      boot.close()
    }
  })

  it('TRE-94: «Qual o valor da massagem?» lista tipos com R$ (não cede ao modelo)', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    try {
      const tenantId = 'clinic-demo-a'
      const caller = workerCaller(tenantId)
      const svc = upsertServiceOp(
        boot.db,
        caller,
        {
          name: 'Massagem',
          durationMinutes: 60,
          bufferMinutes: 0,
          priceCents: null,
          variantKind: 'tipo',
          variantKindPlural: 'tipos',
          variantSelection: 'uma',
          professionalIds: [],
          roomRequirement: { mode: 'none' },
        },
        clock,
      )
      replaceServiceZonesOp(
        boot.db,
        caller,
        svc.id,
        [
          {
            name: 'Liberação miofascial',
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
        ],
        clock,
      )
      const contact = upsertContact(
        boot.db,
        { tenantId, waId: '5511900000099', displayName: 'Cliente' },
        clock,
      )
      const conversation = createConversation(boot.db, { tenantId, contactId: contact.id }, clock)
      const opts = { conversationId: conversation.id }

      insertMessage(
        boot.db,
        {
          tenantId,
          conversationId: conversation.id,
          direction: 'inbound',
          body: 'Qual o valor da massagem?',
          deliveryState: 'received',
          createdAt: clock.nowMs(),
        },
        clock,
      )
      const ask = catalogReply(boot.db, tenantId, 'Qual o valor da massagem?', clock, {
        ...opts,
        turn: catalogTurn(boot.db, tenantId, 'Qual o valor da massagem?', clock, conversation.id),
      })
      expect(ask).toMatch(/relaxante/i)
      expect(ask).toMatch(/R\$\s*200,00/)
      expect(ask).not.toMatch(/qual tipo\?/i)
      expect(ask).not.toMatch(/não tenho o valor/i)
      // D4: FAQ de preço não trava variante no quadro.
      expect(getScheduleSession(boot.db, tenantId, conversation.id)?.variantIds).toBeFalsy()
    } finally {
      boot.close()
    }
  })

  it('D4 bridge: «Quero» após preço de um tipo trava essa variante (Massagem uma)', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    try {
      const tenantId = 'clinic-demo-a'
      const caller = workerCaller(tenantId)
      const svc = upsertServiceOp(
        boot.db,
        caller,
        {
          name: 'Massagem',
          durationMinutes: 60,
          bufferMinutes: 0,
          priceCents: 20_000,
          variantKind: 'tipo',
          variantKindPlural: 'tipos',
          variantSelection: 'uma',
          professionalIds: [],
          roomRequirement: { mode: 'none' },
        },
        clock,
      )
      replaceServiceZonesOp(
        boot.db,
        caller,
        svc.id,
        [
          {
            name: 'Liberação miofascial',
            audience: 'ambos',
            durationMinutes: 60,
            priceCents: 20_000,
          },
          {
            name: 'Massagem relaxante',
            audience: 'ambos',
            durationMinutes: 50,
            priceCents: 15_000,
          },
        ],
        clock,
      )
      const contact = upsertContact(
        boot.db,
        { tenantId, waId: '5511900000088', displayName: 'Cliente' },
        clock,
      )
      const conversation = createConversation(boot.db, { tenantId, contactId: contact.id }, clock)
      const opts = { conversationId: conversation.id }
      const liberacao = boot.db.get<{ id: string }>(
        `SELECT id FROM service_zones WHERE service_id = ? AND name = 'Liberação miofascial'`,
        svc.id,
      )!.id

      insertMessage(
        boot.db,
        {
          tenantId,
          conversationId: conversation.id,
          direction: 'inbound',
          body: 'Quanto custa a liberação miofascial?',
          deliveryState: 'received',
          createdAt: clock.nowMs(),
        },
        clock,
      )
      const priceReply = catalogReply(
        boot.db,
        tenantId,
        'Quanto custa a liberação miofascial?',
        clock,
        opts,
      )
      expect(priceReply).toMatch(/R\$/)
      expect(getScheduleSession(boot.db, tenantId, conversation.id)?.variantIds).toBeFalsy()
      expect(getScheduleSession(boot.db, tenantId, conversation.id)?.serviceId).toBe(svc.id)

      clock.advance(1_000)
      insertMessage(
        boot.db,
        {
          tenantId,
          conversationId: conversation.id,
          direction: 'outbound',
          body: priceReply!,
          deliveryState: 'delivered',
          createdAt: clock.nowMs(),
        },
        clock,
      )
      clock.advance(1_000)
      insertMessage(
        boot.db,
        {
          tenantId,
          conversationId: conversation.id,
          direction: 'inbound',
          body: 'Quero',
          deliveryState: 'received',
          createdAt: clock.nowMs(),
        },
        clock,
      )
      expect(catalogReply(boot.db, tenantId, 'Quero', clock, opts)).toBeNull()
      expect(getScheduleSession(boot.db, tenantId, conversation.id)?.variantIds).toEqual([liberacao])
    } finally {
      boot.close()
    }
  })

  it('TRE-94 a frio: «Quanto custa depilação?» (e sem acento) dá faixa com R$', () => {
    const boot = seedMixed()
    try {
      for (const ask of ['Quanto custa depilação?', 'quanto custa a depilacao']) {
        const reply = catalogReply(boot.db, boot.tenantId, ask, boot.clock, {
          conversationId: boot.conversation.id,
        })
        expect(reply, ask).toMatch(/R\$\s*50,00/)
        expect(reply, ask).toMatch(/R\$\s*180,00/)
        expect(reply, ask).not.toMatch(/feminina ou masculina|quais zonas/i)
        expect(reply, ask).not.toMatch(/Não tenho os valores/i)
      }
    } finally {
      boot.close()
    }
  })

  it('TRE-94: «Quanto custa a massagem?» lista tipos com R$', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    try {
      const tenantId = 'clinic-demo-a'
      const caller = workerCaller(tenantId)
      const svc = upsertServiceOp(
        boot.db,
        caller,
        {
          name: 'Massagem',
          durationMinutes: 60,
          bufferMinutes: 0,
          priceCents: null,
          variantKind: 'tipo',
          variantKindPlural: 'tipos',
          variantSelection: 'uma',
          professionalIds: [],
          roomRequirement: { mode: 'none' },
        },
        clock,
      )
      replaceServiceZonesOp(
        boot.db,
        caller,
        svc.id,
        [
          { name: 'Liberação miofascial', audience: 'ambos', durationMinutes: 60, priceCents: 20_000 },
          { name: 'Massagem relaxante', audience: 'ambos', durationMinutes: 60, priceCents: 20_000 },
          { name: 'Ventosaterapia', audience: 'ambos', durationMinutes: 60, priceCents: 18_000 },
        ],
        clock,
      )
      const contact = upsertContact(
        boot.db,
        { tenantId, waId: '5511900000098', displayName: 'Cliente' },
        clock,
      )
      const conversation = createConversation(boot.db, { tenantId, contactId: contact.id }, clock)
      const reply = catalogReply(boot.db, tenantId, 'quanto custa a massagem', clock, {
        conversationId: conversation.id,
      })
      expect(reply).toMatch(/R\$\s*200,00/)
      expect(reply).toMatch(/R\$\s*180,00/)
      expect(reply).toMatch(/relaxante/i)
      expect(reply).not.toMatch(/qual tipo/i)
      expect(reply).not.toMatch(/Não tenho/i)
    } finally {
      boot.close()
    }
  })

  it('INT-05: «Quais os valores da depilação?» responde faixa com R$ no 1.º turno', () => {
    const boot = seedMixed()
    try {
      const opts = { conversationId: boot.conversation.id }
      const ask = catalogReply(boot.db, boot.tenantId, 'Quais os valores da depilação?', boot.clock, opts)
      expect(ask).toMatch(/R\$\s*50,00/)
      expect(ask).toMatch(/R\$\s*180,00/)
      expect(ask).not.toMatch(/feminina ou masculina/i)
      expect(ask).not.toMatch(/Não tenho os valores/i)
    } finally {
      boot.close()
    }
  })

  it('INT-06: linha masculina conhecida → preço lista tabela da linha', () => {
    const boot = seedMixed()
    try {
      const opts = { conversationId: boot.conversation.id }
      saveScheduleSession(boot.db, boot.tenantId, boot.conversation.id, {
        serviceId: boot.svc.id,
        audienceLine: 'masculino',
      }, boot.clock)
      const ask = catalogReply(boot.db, boot.tenantId, 'Quanto custa a depilação?', boot.clock, opts)
      expect(ask).toMatch(/R\$\s*80,00/)
      expect(ask).toMatch(/R\$\s*180,00/)
      expect(ask).not.toMatch(/Não tenho os valores/i)
    } finally {
      boot.close()
    }
  })

  it('não pede a zona outra vez depois de a cliente ter escolhido axila masculina (sem preço)', () => {
    const boot = seedMixed()
    try {
      const opts = { conversationId: boot.conversation.id }
      // Grava linha+variante pelo caminho de marcação (não consulta de preço).
      saveScheduleSession(
        boot.db,
        boot.tenantId,
        boot.conversation.id,
        {
          serviceId: boot.svc.id,
          audienceLine: 'masculino',
          variantIds: [
            boot.db.get<{ id: string }>(
              `SELECT id FROM service_zones WHERE service_id = ? AND name = 'Axila' AND audience = 'masculino'`,
              boot.svc.id,
            )!.id,
          ],
        },
        boot.clock,
      )
      const next = catalogReply(boot.db, boot.tenantId, 'Quero depilação na segunda à tarde.', boot.clock, opts)
      expect(next).toBeNull()
    } finally {
      boot.close()
    }
  })

  it('«quais zonas» quando o tipo cadastrado já está no plural', () => {
    const boot = seedMixed()
    try {
      upsertServiceOp(
        boot.db,
        boot.caller,
        {
          id: boot.svc.id,
          name: 'Depilação',
          durationMinutes: 15,
          bufferMinutes: 15,
          priceCents: 5000,
          variantKind: 'Zonas',
          variantKindPlural: 'Zonas',
          professionalIds: [],
        },
        boot.clock,
      )
      expect(catalogReply(boot.db, boot.tenantId, 'Quero depilação feminina amanhã à tarde.', boot.clock, {
        conversationId: boot.conversation.id,
      })).toMatch(/quais zonas/i)
    } finally {
      boot.close()
    }
  })

  it('recusa masculino e feminino juntos e não trata «às 3» como 03:00', () => {
    const boot = seedMixed()
    try {
      const opts = { conversationId: boot.conversation.id }
      expect(
        catalogReply(boot.db, boot.tenantId, 'Quero axila masculina e axila feminina juntas.', boot.clock, opts),
      ).toMatch(/juntar masculino e feminino|não entram na mesma visita/i)
      expect(catalogReply(boot.db, boot.tenantId, 'Pode ser às 3.', boot.clock, opts)).toMatch(
        /Você quis dizer 15:00, à tarde\?/,
      )
      expect(catalogReply(boot.db, boot.tenantId, 'Pode ser às 15.', boot.clock, opts)).toBeNull()
      expect(catalogReply(boot.db, boot.tenantId, 'Pode ser às 3 da tarde.', boot.clock, opts)).toBeNull()
    } finally {
      boot.close()
    }
  })

  it('com a linha já dita, zonas sem dia nem preço gravam a sessão e cedem ao autobook (DEC-135)', () => {
    const boot = seedMixed()
    try {
      const existing = boot.db.all<{
        id: string
        name: string
        duration_minutes: number
        price_cents: number
        audience: 'feminino' | 'masculino'
      }>(
        `SELECT id, name, duration_minutes, price_cents, audience
         FROM service_zones WHERE tenant_id = ? AND service_id = ? ORDER BY sort_order`,
        boot.tenantId,
        boot.svc.id,
      )
      const zones = replaceServiceZonesOp(
        boot.db,
        boot.caller,
        boot.svc.id,
        [
          ...existing.map((zone) => ({
            id: zone.id,
            name: zone.name,
            durationMinutes: zone.duration_minutes,
            priceCents: zone.price_cents,
            audience: zone.audience,
          })),
          { name: 'Parte íntima', durationMinutes: 20, priceCents: 9_000, audience: 'feminino' as const },
          { name: 'Parte íntima', durationMinutes: 25, priceCents: 11_000, audience: 'masculino' as const },
        ],
        boot.clock,
      )
      const opts = { conversationId: boot.conversation.id }
      const say = (direction: 'inbound' | 'outbound', body: string) => {
        boot.clock.advance(1_000)
        insertMessage(
          boot.db,
          {
            tenantId: boot.tenantId,
            conversationId: boot.conversation.id,
            direction,
            body,
            deliveryState: direction === 'inbound' ? 'received' : 'delivered',
            createdAt: boot.clock.nowMs(),
          },
          boot.clock,
        )
      }
      // A linha chegou numa volta anterior que não gravou sessão (atalho ainda fechado).
      say('inbound', 'Feminina')
      say('outbound', 'Qual zona e qual dia?')
      say('inbound', 'Parte intima e axila')
      expect(getScheduleSession(boot.db, boot.tenantId, boot.conversation.id)).toBeNull()
      // DEC-135: catálogo não rouba o turno com perguntar_horario — null → tryAiAutoBook + Horários.
      expect(catalogReply(boot.db, boot.tenantId, 'Parte intima e axila', boot.clock, opts)).toBeNull()
      const fem = zones
        .filter((zone) => zone.audience === 'feminino' && (zone.name === 'Axila' || zone.name === 'Parte íntima'))
        .map((zone) => zone.id)
        .sort()
      expect(getScheduleSession(boot.db, boot.tenantId, boot.conversation.id)).toMatchObject({
        serviceId: boot.svc.id,
        audienceLine: 'feminino',
      })
      expect([...(getScheduleSession(boot.db, boot.tenantId, boot.conversation.id)?.variantIds ?? [])].sort()).toEqual(
        fem,
      )
    } finally {
      boot.close()
    }
  })

  it('reconhece Brinzeamento escrito com uma letra a menos', () => {
    const boot = seedMixed()
    try {
      const bronze = upsertServiceOp(
        boot.db,
        boot.caller,
        {
          name: 'Brinzeamento',
          durationMinutes: 60,
          bufferMinutes: 15,
          priceCents: 15_000,
          professionalIds: [],
          roomRequirement: { mode: 'none' },
        },
        boot.clock,
      )
      const reply = catalogReply(
        boot.db,
        boot.tenantId,
        'Quero brinzeamento na quinta-feira de manhã.',
        boot.clock,
        { conversationId: boot.conversation.id },
      )
      expect(reply).toBeNull()
      expect(getScheduleSession(boot.db, boot.tenantId, boot.conversation.id)?.serviceId).toBe(bronze.id)
    } finally {
      boot.close()
    }
  })

  it('handoff determinístico: terceiro, inexistente e histórico indisponível', () => {
    const boot = seedMixed()
    try {
      const opts = { conversationId: boot.conversation.id }
      expect(
        catalogReply(boot.db, boot.tenantId, 'Quero marcar depilação pra minha mãe', boot.clock, opts),
      ).toMatch(/outra pessoa/)
      // Sem dia: declara inexistente. Com «amanhã» o gate de período cede ao autobook
      // (o PERIOD antigo falhava em «amanhã» por `\b`+acento; o helper TRE-60 corrige).
      const miss = catalogReply(
        boot.db,
        boot.tenantId,
        'Quero bronzeamento artificial',
        boot.clock,
        opts,
      )
      expect(miss).toMatch(/bronzeamento/i)
      expect(miss).toMatch(/não entendi|não encontrei/i)
      expect(miss).toMatch(/Temos /)
      expect(miss).not.toMatch(/maps\.|goo\.gl|google/i)
      expect(
        catalogReply(
          boot.db,
          boot.tenantId,
          'Quero bronzeamento artificial amanhã',
          boot.clock,
          opts,
        ),
      ).toBeNull()
      expect(
        catalogReply(boot.db, boot.tenantId, 'Quero igual à última vez', boot.clock, opts),
      ).toMatch(/visita anterior/i)
    } finally {
      boot.close()
    }
  })

  it('#512 prática 10: «Vocês fazem botox?» diz o que faltou e lista opções (sem Google)', () => {
    const boot = seedMixed()
    try {
      const reply = catalogReply(
        boot.db,
        boot.tenantId,
        'Vocês fazem botox?',
        boot.clock,
        { conversationId: boot.conversation.id },
      )
      expect(reply).toMatch(/botox/i)
      expect(reply).toMatch(/Temos /)
      expect(reply).toMatch(/Depilação|Limpeza|Massagem/i)
      expect(reply).not.toMatch(/maps\.|goo\.gl|google/i)
      expect(reply).not.toMatch(/\bcatálogo\b/i)
    } finally {
      boot.close()
    }
  })

  it('DEC-185 / TRE-60: cumprimento «boa tarde» não bloqueia FAQ publicada', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const tenantId = 'clinic-faq-greeting'
    try {
      const cat = upsertKnowledgeCategory(boot.db, tenantId, { name: 'Pets' }, clock)
      upsertKnowledgeEntry(
        boot.db,
        tenantId,
        {
          categoryId: cat.id,
          question: 'Posso levar o meu pet?',
          answer: 'Sim, os seus bichanos são muito bem vindos!',
          status: 'published',
        },
        'owner',
        clock,
      )
      expect(catalogReply(boot.db, tenantId, 'Posso levar o meu pet?', clock)).toBe(
        'Sim, os seus bichanos são muito bem vindos!',
      )
      expect(
        catalogReply(boot.db, tenantId, 'Boa tarde, posso levar o meu pet?', clock),
      ).toBe('Sim, os seus bichanos são muito bem vindos!')
      expect(
        catalogReply(boot.db, tenantId, 'Boa noite, posso levar o meu pet?', clock),
      ).toBe('Sim, os seus bichanos são muito bem vindos!')
    } finally {
      boot.close()
    }
  })

  it('DEC-177 / TRE-100: «o que inclui a íntima?» lê client_explanation (não LLM)', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const tenantId = 'clinic-demo-faq-intima'
    const caller = workerCaller(tenantId)
    try {
      const svc = upsertServiceOp(
        boot.db,
        caller,
        {
          name: 'Depilação',
          durationMinutes: 30,
          bufferMinutes: 0,
          priceCents: null,
          variantKind: 'Zona',
          variantKindPlural: 'Zonas',
          professionalIds: [],
          roomRequirement: { mode: 'none' },
          clientExplanation: 'Remoção dos pelos pela raiz — prosa do serviço.',
        },
        clock,
      )
      replaceServiceZonesOp(
        boot.db,
        caller,
        svc.id,
        [
          {
            name: 'Intima',
            audience: 'feminino',
            durationMinutes: 20,
            priceCents: 15_000,
            clientExplanation: 'Inclui virilha e genital no feminino.',
          },
          {
            name: 'Intima',
            audience: 'masculino',
            durationMinutes: 20,
            priceCents: 20_000,
            clientExplanation: 'Zona íntima com cera.',
            clientExplanationAudience: 'Inclui virilha, genital e perianal no masculino.',
          },
          { name: 'Axila', audience: 'feminino', durationMinutes: 15, priceCents: 4_000 },
        ],
        clock,
      )
      const withFact = catalogReply(
        boot.db,
        tenantId,
        'O que inclui a íntima?',
        clock,
      )
      expect(withFact).toMatch(/Inclui virilha e genital no feminino/)
      expect(withFact).not.toMatch(/Remoção dos pelos|prosa do serviço/i)

      const masculine = catalogReply(
        boot.db,
        tenantId,
        'O que inclui a depilação íntima masculina?',
        clock,
      )
      expect(masculine).toMatch(/perianal no masculino/)
      expect(masculine).not.toMatch(/no feminino|Remoção dos pelos|prosa do serviço/i)
    } finally {
      boot.close()
    }
  })

  it('DEC-177 / TRE-100: íntima sem explicação → frase missing (não prosa do serviço)', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const tenantId = 'clinic-demo-faq-intima-missing'
    const caller = workerCaller(tenantId)
    try {
      const svc = upsertServiceOp(
        boot.db,
        caller,
        {
          name: 'Depilação',
          durationMinutes: 30,
          bufferMinutes: 0,
          priceCents: null,
          variantKind: 'Zona',
          variantKindPlural: 'Zonas',
          professionalIds: [],
          roomRequirement: { mode: 'none' },
          clientExplanation: 'Remoção dos pelos pela raiz utilizando cera.',
        },
        clock,
      )
      replaceServiceZonesOp(
        boot.db,
        caller,
        svc.id,
        [
          {
            name: 'Intima',
            audience: 'feminino',
            durationMinutes: 20,
            priceCents: 15_000,
            clientExplanation: null,
          },
        ],
        clock,
      )
      const missing = catalogReply(boot.db, tenantId, 'O que inclui a íntima?', clock)
      expect(missing).toBe('Não tenho esse detalhe no cadastro; a equipe confirma.')
      expect(missing).not.toMatch(/Remoção dos pelos|cera/i)
    } finally {
      boot.close()
    }
  })

  it('TRE-112: «Fazem depilação íntima?» lê client_explanation (não LLM / rememberZones)', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const tenantId = 'clinic-demo-faq-offer-intima'
    const caller = workerCaller(tenantId)
    try {
      const svc = upsertServiceOp(
        boot.db,
        caller,
        {
          name: 'Depilação',
          durationMinutes: 30,
          bufferMinutes: 0,
          priceCents: null,
          variantKind: 'Zona',
          variantKindPlural: 'Zonas',
          professionalIds: [],
          roomRequirement: { mode: 'none' },
          clientExplanation: 'Remoção dos pelos pela raiz — prosa do serviço.',
        },
        clock,
      )
      replaceServiceZonesOp(
        boot.db,
        caller,
        svc.id,
        [
          {
            name: 'íntima',
            audience: 'feminino',
            durationMinutes: 30,
            priceCents: 12_000,
            clientExplanation:
              'A depilação íntima com cera é um procedimento de remoção dos pelos pela raiz.',
          },
        ],
        clock,
      )
      const cold = catalogReply(boot.db, tenantId, 'Fazem depilação íntima?', clock)
      expect(cold).toMatch(/depilação íntima com cera/i)
      expect(cold).not.toMatch(/prosa do serviço|não tenho.*certeza|Não tenho esse detalhe/i)

      const contact = upsertContact(
        boot.db,
        { tenantId, waId: '5511999000112', displayName: 'Cliente FAQ oferta' },
        clock,
      )
      const conversation = createConversation(boot.db, { tenantId, contactId: contact.id }, clock)
      const withSession = catalogReply(boot.db, tenantId, 'Fazem depilação íntima?', clock, {
        conversationId: conversation.id,
      })
      expect(withSession).toMatch(/depilação íntima com cera/i)
      // Booking frame não ganha variantes (DEC-202); DEC-223 grava sujeito informativo.
      expect(getScheduleSession(boot.db, tenantId, conversation.id)?.variantIds ?? []).toEqual([])
    } finally {
      boot.close()
    }
  })

  it('TRE-113: forceFaqCatalog sem cue («Sobre a íntima») lê cadastro e não grava zona', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const tenantId = 'clinic-demo-faq-force-intima'
    const caller = workerCaller(tenantId)
    try {
      const svc = upsertServiceOp(
        boot.db,
        caller,
        {
          name: 'Depilação',
          durationMinutes: 30,
          bufferMinutes: 0,
          priceCents: null,
          variantKind: 'Zona',
          variantKindPlural: 'Zonas',
          professionalIds: [],
          roomRequirement: { mode: 'none' },
          clientExplanation: 'Remoção dos pelos pela raiz — prosa do serviço.',
        },
        clock,
      )
      replaceServiceZonesOp(
        boot.db,
        caller,
        svc.id,
        [
          {
            name: 'íntima',
            audience: 'feminino',
            durationMinutes: 30,
            priceCents: 12_000,
            clientExplanation: 'Inclui virilha e genital no feminino.',
          },
        ],
        clock,
      )
      expect(catalogReply(boot.db, tenantId, 'Sobre a íntima', clock)).toBeNull()
      const forced = catalogReply(boot.db, tenantId, 'Sobre a íntima', clock, {
        forceFaqCatalog: true,
      })
      expect(forced).toMatch(/virilha e genital/i)
      expect(forced).not.toMatch(/prosa do serviço|Não tenho esse detalhe/i)

      const contact = upsertContact(
        boot.db,
        { tenantId, waId: '5511999000113', displayName: 'Cliente FAQ force' },
        clock,
      )
      const conversation = createConversation(boot.db, { tenantId, contactId: contact.id }, clock)
      const withSession = catalogReply(boot.db, tenantId, 'Sobre a íntima', clock, {
        conversationId: conversation.id,
        forceFaqCatalog: true,
      })
      expect(withSession).toMatch(/virilha e genital/i)
      expect(getScheduleSession(boot.db, tenantId, conversation.id)?.variantIds ?? []).toEqual([])
    } finally {
      boot.close()
    }
  })
})
