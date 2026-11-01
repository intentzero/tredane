/** Respostas de catálogo sem modelo: almoço, duração, quem faz, zona (sem sala/buffer ao cliente). */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { replaceServiceZonesOp, setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { catalogReply } from './catalog-reply'
import { formatOpeningHours } from './schedule-context'
import { handoffReason } from './human-handoff'
import { clearScheduleSession, getScheduleSession, scheduleFactsFromText } from './schedule-session'

const NOW = Date.UTC(2026, 9, 30, 21, 0)

describe('catalogReply', () => {
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

    expect(catalogReply(boot.db, tenantId, 'Quanto custa a axila masculina e quanto tempo dura?', clock)).toBe(
      'Axila masculina custa R$ 50,00 e dura 15 min.',
    )
    const who = catalogReply(boot.db, tenantId, 'Quem faz a depilação e em qual sala?', clock)
    expect(who).toContain('Gi')
    expect(who).not.toContain('Sala Depilação')
    expect(who).not.toMatch(/\bsala\b/i)
    expect(catalogReply(boot.db, tenantId, 'Quero depilação amanhã à tarde.', clock)).toMatch(/qual/i)
    expect(catalogReply(boot.db, tenantId, 'Quero depilação amanhã à tarde.', clock)).not.toMatch(/13:00/)
    const both = catalogReply(
      boot.db,
      tenantId,
      'Se eu fizer axila masculina e pernas masculinas juntas, qual o preço e a duração?',
      clock,
    )
    expect(both).toBe('Juntas, ficam R$ 190,00 e 45 min de atendimento.')
    expect(both).not.toMatch(/intervalo|ocupa a agenda|buffer/i)
    expect(handoffReason(boot.db, tenantId, 'Quero marcar com a Sandra.', clock)).toBe('human_only')
    expect(handoffReason(boot.db, tenantId, 'Quero com a Gi.', clock)).toBeNull()
    void sandra
    boot.close()
  })
})

describe('linha antes das zonas (DEC-078 / DEC-075)', () => {
  const LINE = 'Depilação feminina ou masculina?'
  const ZONES = 'Para Depilação, qual zona você quer? Temos Axila, Pernas.'

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
      expect(catalogReply(boot.db, boot.tenantId, 'Quero depilação amanhã à tarde.', boot.clock, opts)).toBe(LINE)
      expect(getScheduleSession(boot.db, boot.tenantId, boot.conversation.id)).toMatchObject({
        serviceId: boot.svc.id,
        audienceLine: null,
      })
      expect(catalogReply(boot.db, boot.tenantId, 'Feminina', boot.clock, opts)).toBe(ZONES)
      expect(getScheduleSession(boot.db, boot.tenantId, boot.conversation.id)?.audienceLine).toBe('feminino')
      expect(catalogReply(boot.db, boot.tenantId, 'Masculina', boot.clock, opts)).toBe(ZONES)
      expect(
        catalogReply(boot.db, boot.tenantId, 'Quanto custa a axila da depilação feminina?', boot.clock, opts),
      ).toBe('Axila custa R$ 50,00 e dura 15 min.')
      expect(
        catalogReply(boot.db, boot.tenantId, 'Quanto custa a axila da depilação masculina?', boot.clock, opts),
      ).toBe('Axila custa R$ 80,00 e dura 20 min.')
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
      expect(reply).toBe(
        'Para Depilação, qual zona você quer? Temos Axila, Pernas (feminino, 30 min), Pernas (feminino, 45 min).',
      )
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
      expect(reply).toBe(LINE)
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

  it('«Quero depilação na segunda à tarde.» pergunta a linha e guarda segunda e tarde', () => {
    const boot = seedMixed()
    try {
      const opts = { conversationId: boot.conversation.id }
      expect(catalogReply(boot.db, boot.tenantId, 'Quero depilação na segunda à tarde.', boot.clock, opts)).toBe(LINE)
      expect(getScheduleSession(boot.db, boot.tenantId, boot.conversation.id)).toMatchObject({
        serviceId: boot.svc.id,
        audienceLine: null,
        dayLabel: 'segunda',
        period: 'tarde',
      })
      expect(catalogReply(boot.db, boot.tenantId, 'Feminina', boot.clock, opts)).toBe(ZONES)
      expect(getScheduleSession(boot.db, boot.tenantId, boot.conversation.id)).toMatchObject({
        serviceId: boot.svc.id,
        audienceLine: 'feminino',
        dayLabel: 'segunda',
        period: 'tarde',
      })
      expect(catalogReply(boot.db, boot.tenantId, 'Quero depilação feminina na segunda à tarde.', boot.clock, opts)).toBe(
        ZONES,
      )
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
      expect(catalogReply(boot.db, boot.tenantId, 'Quero depilação amanhã à tarde.', boot.clock, opts)).toBe(LINE)
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
      expect(catalogReply(boot.db, boot.tenantId, 'Quero depilação amanhã à tarde.', boot.clock, opts)).toBe(LINE)
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
      expect(catalogReply(boot.db, boot.tenantId, 'Quero depilação amanhã à tarde.', boot.clock, opts)).toBe(LINE)
      boot.clock.advance(1_000)
      expect(catalogReply(boot.db, boot.tenantId, 'Feminina', boot.clock, opts)).toBe(ZONES)
      expect(getScheduleSession(boot.db, boot.tenantId, boot.conversation.id)?.audienceLine).toBe('feminino')
    } finally {
      boot.close()
    }
  })

  it('não pede a linha outra vez depois de a cliente ter dito axila masculina', () => {
    const boot = seedMixed()
    try {
      const opts = { conversationId: boot.conversation.id }
      expect(
        catalogReply(boot.db, boot.tenantId, 'Quanto custa a axila masculina?', boot.clock, opts),
      ).toMatch(/R\$/)
      const next = catalogReply(boot.db, boot.tenantId, 'Quero depilação na segunda à tarde.', boot.clock, opts)
      expect(next).not.toMatch(/feminina ou masculina/)
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
      ).toMatch(/não entram na mesma visita/)
      expect(catalogReply(boot.db, boot.tenantId, 'Pode ser às 3.', boot.clock, opts)).toBe(
        'Às 3 da tarde seria 15:00. É esse horário?',
      )
      expect(catalogReply(boot.db, boot.tenantId, 'Pode ser às 15.', boot.clock, opts)).toBeNull()
      expect(catalogReply(boot.db, boot.tenantId, 'Pode ser às 3 da tarde.', boot.clock, opts)).toBeNull()
    } finally {
      boot.close()
    }
  })

  it('com a linha já dita, zonas sem dia nem preço perguntam o horário', () => {
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
      expect(catalogReply(boot.db, boot.tenantId, 'Parte intima e axila', boot.clock, opts)).toBe(
        'Qual horário fica melhor para Depilação?',
      )
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
})
