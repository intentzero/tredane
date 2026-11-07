/**
 * BookingFrame — DEC-127, propriedades, WS e limpeza (#412 M2).
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { upsertContact } from '../contacts'
import { createConversation } from '../inbox/conversations'
import { workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { bindOrAssertTenant } from '../tenant'
import {
  replaceServiceZonesOp,
  setServiceActiveOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import {
  clearBookingFrame,
  getBookingFrame,
  heldAudienceLine,
  saveBookingFrame,
  syncBookingFrameWithCatalog,
  wouldAskFilledSlot,
  type BookingFrame,
} from './schedule-session'
import {
  isPendingOfferFresh,
  matchPendingChoice,
  PENDING_OFFER_TTL_MS,
} from './booking-frame-choice'
import {
  clearCompiledCatalogCache,
  getOrCompileCatalog,
  loadTurnContext,
  readCatalogVersion,
} from './turn-context'

function boot() {
  const clock = createControllableClock(Date.UTC(2026, 10, 5, 15, 0))
  const { db, close } = bootClinicDb({ clock })
  const tenantId = 'clinic-demo-bf'
  const caller = workerCaller(tenantId)
  bindOrAssertTenant(db, caller, clock)
  const contact = upsertContact(
    db,
    { tenantId, waId: '5511999000001', displayName: 'Ana' },
    clock,
  )
  const conversation = createConversation(
    db,
    { tenantId, contactId: contact.id, status: 'open' },
    clock,
  )
  return { db, clock, tenantId, conversationId: conversation.id, close, caller }
}

describe('BookingFrame API', () => {
  it('grava e lê o contrato §3.3; emite booking_frame.updated', () => {
    const { db, clock, tenantId, conversationId, close } = boot()
    try {
      const { frame, outbox } = saveBookingFrame(
        db,
        tenantId,
        conversationId,
        {
          serviceId: 'svc1',
          line: 'feminino',
          date: '2026-11-06',
          period: 'tarde',
          time: '14:00',
          variantIds: ['z1'],
          catalogVersion: '1:2',
          pending: {
            slot: 'horario',
            options: [
              { key: '14:00', label: 'sexta 06/11 às 14:00' },
              { key: '15:00', label: 'sexta 06/11 às 15:00' },
            ],
            messageId: 'msg1',
          },
          lastOffer: {
            slots: [{ startsAt: Date.UTC(2026, 10, 6, 17, 0), professionalId: 'p1' }],
            messageId: 'msg1',
          },
          sourceMessageId: 'msg-in',
          source: 'regra',
        },
        clock,
      )
      expect(frame.serviceId).toBe('svc1')
      expect(frame.date).toBe('2026-11-06')
      expect(frame.pending?.options).toHaveLength(2)
      expect(outbox?.type).toBe('booking_frame.updated')
      expect(getBookingFrame(db, tenantId, conversationId)?.time).toBe('14:00')
    } finally {
      close()
    }
  })

  it('troca de serviço limpa linha, variantes, hora, pending e lastOffer', () => {
    const { db, clock, tenantId, conversationId, close } = boot()
    try {
      saveBookingFrame(
        db,
        tenantId,
        conversationId,
        {
          serviceId: 'svc1',
          line: 'feminino',
          time: '14:00',
          variantIds: ['z1'],
          pending: {
            slot: 'horario',
            options: [{ key: '14:00', label: '14:00' }],
            messageId: 'm1',
          },
          lastOffer: { slots: [{ startsAt: 1, professionalId: 'p' }], messageId: 'm1' },
        },
        clock,
      )
      const { frame } = saveBookingFrame(
        db,
        tenantId,
        conversationId,
        { serviceId: 'svc2' },
        clock,
      )
      expect(frame.serviceId).toBe('svc2')
      expect(frame.line).toBeNull()
      expect(frame.variantIds).toBeNull()
      expect(frame.time).toBeNull()
      expect(frame.pending).toBeNull()
      expect(frame.lastOffer).toBeNull()
    } finally {
      close()
    }
  })

  it('clear volta a idle / sem linha', () => {
    const { db, clock, tenantId, conversationId, close } = boot()
    try {
      saveBookingFrame(
        db,
        tenantId,
        conversationId,
        { serviceId: 'svc1', date: '2026-11-06' },
        clock,
      )
      clearBookingFrame(db, tenantId, conversationId, clock)
      expect(getBookingFrame(db, tenantId, conversationId)).toBeNull()
    } finally {
      close()
    }
  })

  it('isolamento: clínica A ≠ B (dois DOs)', () => {
    const a = boot()
    const clockB = createControllableClock(Date.UTC(2026, 10, 5, 15, 0))
    const bootB = bootClinicDb({ clock: clockB })
    try {
      const tenantB = 'clinic-demo-bf-b'
      bindOrAssertTenant(bootB.db, workerCaller(tenantB), clockB)
      const contactB = upsertContact(
        bootB.db,
        { tenantId: tenantB, waId: '5511999000002', displayName: 'Bia' },
        clockB,
      )
      const convB = createConversation(
        bootB.db,
        { tenantId: tenantB, contactId: contactB.id, status: 'open' },
        clockB,
      )
      saveBookingFrame(a.db, a.tenantId, a.conversationId, { serviceId: 'svcA' }, a.clock)
      saveBookingFrame(bootB.db, tenantB, convB.id, { serviceId: 'svcB' }, clockB)
      expect(getBookingFrame(a.db, a.tenantId, a.conversationId)?.serviceId).toBe('svcA')
      expect(getBookingFrame(bootB.db, tenantB, convB.id)?.serviceId).toBe('svcB')
      expect(getBookingFrame(a.db, tenantB, convB.id)).toBeNull()
    } finally {
      a.close()
      bootB.close()
    }
  })
})

describe('DEC-127 validade 24 h', () => {
  it('23h59 vale; 24h01 não', () => {
    const created = Date.UTC(2026, 10, 5, 12, 0)
    expect(isPendingOfferFresh(created, created + PENDING_OFFER_TTL_MS - 60_000)).toBe(true)
    expect(isPendingOfferFresh(created, created + PENDING_OFFER_TTL_MS)).toBe(true)
    expect(isPendingOfferFresh(created, created + PENDING_OFFER_TTL_MS + 60_000)).toBe(false)
  })
})

describe('DEC-127 matchPendingChoice', () => {
  const pending = {
    slot: 'horario',
    messageId: 'm1',
    options: [
      { key: '13:00', label: 'amanhã às 13:00' },
      { key: '14:00', label: 'amanhã às 14:00' },
      { key: '15:30', label: 'amanhã às 15:30' },
    ],
  }

  it('«Sexta às 0900» casa 09:00 da lista (sem dois-pontos)', () => {
    const friday = {
      slot: 'horario' as const,
      messageId: 'm1',
      options: [
        { key: '2026-11-06T09:00', label: 'sexta 06/11 09:00' },
        { key: '2026-11-06T09:30', label: 'sexta 06/11 09:30' },
        { key: '2026-11-06T10:00', label: 'sexta 06/11 10:00' },
      ],
    }
    expect(matchPendingChoice('Sexta às 0900', friday)).toEqual({
      kind: 'match',
      key: '2026-11-06T09:00',
      label: 'sexta 06/11 09:00',
    })
    expect(matchPendingChoice('09:00', friday).kind).toBe('match')
  })

  it('«o das 14» casa a opção 14:00 (A-07)', () => {
    expect(matchPendingChoice('o das 14', pending)).toEqual({
      kind: 'match',
      key: '14:00',
      label: 'amanhã às 14:00',
    })
  })

  it('#507: «o das 14» e «a terça» funcionam com chave civil YYYY-MM-DDTHH:MM', () => {
    const civil = {
      slot: 'horario',
      messageId: 'm1',
      options: [
        { key: '2026-11-03T14:00', label: 'terça 03/11 14:00' },
        { key: '2026-11-03T15:30', label: 'terça 03/11 15:30' },
        { key: '2026-11-04T14:00', label: 'quarta 04/11 14:00' },
      ],
    }
    expect(matchPendingChoice('15:30', civil)).toEqual({
      kind: 'match',
      key: '2026-11-03T15:30',
      label: 'terça 03/11 15:30',
    })
    expect(matchPendingChoice('o das 14', civil)).toEqual({ kind: 'ambiguous' })
    expect(matchPendingChoice('a terça', {
      slot: 'horario',
      messageId: 'm1',
      options: [
        { key: '2026-11-03T14:00', label: 'terça 03/11 14:00' },
        { key: '2026-11-04T14:00', label: 'quarta 04/11 14:00' },
      ],
    })).toEqual({
      kind: 'match',
      key: '2026-11-03T14:00',
      label: 'terça 03/11 14:00',
    })
    expect(matchPendingChoice('👍', {
      slot: 'horario',
      messageId: 'm',
      options: [{ key: '2026-11-03T17:00', label: 'terça 03/11 17:00' }],
    })).toEqual({
      kind: 'match',
      key: '2026-11-03T17:00',
      label: 'terça 03/11 17:00',
    })
  })

  it('«a segunda opção» casa ordinal 2 (A-08)', () => {
    expect(matchPendingChoice('a segunda opção', pending)).toEqual({
      kind: 'match',
      key: '14:00',
      label: 'amanhã às 14:00',
    })
  })

  it('👍 com uma opção escolhe; com várias pergunta qual (C-05 / DEC-127.3)', () => {
    expect(
      matchPendingChoice('👍', {
        slot: 'horario',
        messageId: 'm',
        options: [{ key: '14:00', label: '14:00' }],
      }),
    ).toEqual({ kind: 'match', key: '14:00', label: '14:00' })
    expect(matchPendingChoice('👍', pending)).toEqual({ kind: 'ask_which' })
    expect(matchPendingChoice('sim', pending)).toEqual({ kind: 'ask_which' })
    expect(
      matchPendingChoice('fechado', {
        slot: 'horario',
        messageId: 'm',
        options: [{ key: '14:00', label: '14:00' }],
      }),
    ).toEqual({ kind: 'match', key: '14:00', label: '14:00' })
  })

  it('ordinal e dia da semana divergentes → ambiguous (DEC-127.2)', () => {
    const opts = {
      slot: 'horario',
      messageId: 'm',
      options: [
        { key: 'a', label: 'sexta às 13:00' },
        { key: 'b', label: 'sábado às 14:00' },
      ],
    }
    expect(matchPendingChoice('a segunda opção', opts).kind).toBe('match')
    expect(matchPendingChoice('a primeira, sexta', opts)).toMatchObject({ kind: 'match', key: 'a' })
    expect(matchPendingChoice('a segunda opção, sexta', opts).kind).toBe('ambiguous')
  })

  /**
   * #472 M2b / DEC-127.2 — «quarta» e «quinta» sem «opção/hora» são dia da semana
   * (mesmo tratamento que «segunda»), nunca a N-ésima opção.
   */
  describe('quarta/quinta: dia vs ordinal (#472)', () => {
    const fourDays = {
      slot: 'horario',
      messageId: 'm',
      options: [
        { key: 'seg-09', label: 'segunda 09:00' },
        { key: 'ter-10', label: 'terça 10:00' },
        { key: 'sex-11', label: 'sexta 11:00' },
        { key: 'sex-14', label: 'sexta 14:00' },
      ],
    }
    const withQuarta = {
      slot: 'horario',
      messageId: 'm',
      options: [
        { key: 'seg-09', label: 'segunda 09:00' },
        { key: 'qua-10', label: 'quarta 10:00' },
        { key: 'sex-11', label: 'sexta 11:00' },
        { key: 'sex-14', label: 'sexta 14:00' },
      ],
    }
    const fiveOpts = {
      slot: 'horario',
      messageId: 'm',
      options: [
        { key: '1', label: 'segunda 09:00' },
        { key: '2', label: 'terça 10:00' },
        { key: '3', label: 'quarta 11:00' },
        { key: '4', label: 'quinta 12:00' },
        { key: '5', label: 'sexta 14:00' },
      ],
    }
    const twoOpts = {
      slot: 'horario',
      messageId: 'm',
      options: [
        { key: 'a', label: 'sexta 11:00' },
        { key: 'b', label: 'sexta 14:00' },
      ],
    }

    it('«a quarta» sem quarta nas opções → none (não a 4.ª)', () => {
      expect(matchPendingChoice('a quarta', fourDays)).toEqual({ kind: 'none' })
      expect(matchPendingChoice('a quarta', twoOpts)).toEqual({ kind: 'none' })
    })

    it('«a quinta» sem quinta nas opções → none (não a 5.ª)', () => {
      expect(matchPendingChoice('a quinta', fourDays)).toEqual({ kind: 'none' })
      expect(matchPendingChoice('a quinta', fiveOpts)).toMatchObject({
        kind: 'match',
        key: '4',
        label: 'quinta 12:00',
      })
    })

    it('«a quarta» com opção nesse dia → match no dia', () => {
      expect(matchPendingChoice('a quarta', withQuarta)).toMatchObject({
        kind: 'match',
        key: 'qua-10',
      })
      expect(matchPendingChoice('a quarta', fiveOpts)).toMatchObject({
        kind: 'match',
        key: '3',
      })
    })

    it('«a quarta opção» / «a quinta opção» usam ordinal', () => {
      expect(matchPendingChoice('a quarta opção', fourDays)).toMatchObject({
        kind: 'match',
        key: 'sex-14',
      })
      expect(matchPendingChoice('a quinta opção', fiveOpts)).toMatchObject({
        kind: 'match',
        key: '5',
      })
      expect(matchPendingChoice('a quarta opção', twoOpts)).toEqual({ kind: 'none' })
      expect(matchPendingChoice('a quinta opção', fourDays)).toEqual({ kind: 'none' })
    })

    it('«a segunda» sem opção nesse dia → none; com «opção» → ordinal', () => {
      expect(matchPendingChoice('a segunda', twoOpts)).toEqual({ kind: 'none' })
      expect(matchPendingChoice('a segunda opção', twoOpts)).toMatchObject({
        kind: 'match',
        key: 'b',
      })
    })
  })
})

describe('propriedades BookingFrame', () => {
  it('não pergunta slot já preenchido', () => {
    const frame: BookingFrame = {
      phase: 'coletando',
      serviceId: 's',
      line: 'feminino',
      variantIds: ['z'],
      professionalPref: null,
      date: '2026-11-06',
      period: 'tarde',
      time: null,
      pending: null,
      lastOffer: null,
      proposal: null,
      rescheduleAppointmentId: null,
      catalogVersion: '',
      provenance: {},
      updatedAt: 1,
    }
    expect(wouldAskFilledSlot(frame, 'serviceId')).toBe(true)
    expect(wouldAskFilledSlot(frame, 'line')).toBe(true)
    expect(wouldAskFilledSlot(frame, 'variantIds')).toBe(true)
    expect(wouldAskFilledSlot(frame, 'date')).toBe(true)
    expect(wouldAskFilledSlot(frame, 'time')).toBe(false)
  })

  it('#510: a mesma propriedade vale para toque, texto e correção (slots do quadro)', () => {
    // Os três caminhos escrevem o mesmo contrato; o gate de pergunta lê só o quadro.
    const filled: BookingFrame = {
      phase: 'coletando',
      serviceId: 's',
      line: 'feminino',
      variantIds: ['z1', 'z2'],
      professionalPref: null,
      date: '2026-11-07',
      period: null,
      time: '10:00',
      pending: null,
      lastOffer: null,
      proposal: null,
      rescheduleAppointmentId: null,
      catalogVersion: '1',
      provenance: {
        line: { messageId: 'm', source: 'botao' },
        variantIds: { messageId: 'm', source: 'regra' },
        time: { messageId: 'm', source: 'botao' },
      },
      updatedAt: 1,
    }
    for (const slot of ['serviceId', 'line', 'variantIds', 'date', 'time'] as const) {
      expect(wouldAskFilledSlot(filled, slot)).toBe(true)
    }
  })

  it('replay idêntico → mesma saída do matchPendingChoice', () => {
    const pending = {
      slot: 'horario',
      messageId: 'm',
      options: [
        { key: '13:00', label: '13:00' },
        { key: '14:00', label: '14:00' },
      ],
    }
    expect(matchPendingChoice('o das 14', pending)).toEqual(
      matchPendingChoice('o das 14', pending),
    )
  })
})

describe('catalogVersion revalidação (#472)', () => {
  function seedCatalog() {
    const { db, clock, tenantId, conversationId, close, caller } = boot()
    const room = upsertResourceOp(
      db,
      caller,
      { kind: 'room', name: 'Sala BF', category: 'Sala' },
      clock,
    )
    const pro = upsertResourceOp(
      db,
      caller,
      { kind: 'professional', name: 'Ana BF', homeRoomId: room.id },
      clock,
    )
    const svc = upsertServiceOp(
      db,
      caller,
      {
        name: 'Limpeza BF',
        durationMinutes: 60,
        bufferMinutes: 0,
        priceCents: 10000,
        professionalIds: [pro.id],
        roomRequirement: { mode: 'none' },
        variantKind: 'zona',
        variantKindPlural: 'zonas',
      },
      clock,
    )
    const zones = replaceServiceZonesOp(
      db,
      caller,
      svc.id,
      [
        {
          name: 'Rosto',
          audience: 'feminino',
          durationMinutes: 60,
          priceCents: 10000,
        },
      ],
      clock,
    )
    clearCompiledCatalogCache(db)
    const catalog = getOrCompileCatalog(db, tenantId, clock)
    const zoneId = zones[0]!.id
    return { db, clock, tenantId, conversationId, close, caller, svc, pro, zoneId, catalog }
  }

  it('owner desactiva o serviço a meio → limpa serviceId; sem substituto', () => {
    const s = seedCatalog()
    try {
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.conversationId,
        {
          serviceId: s.svc.id,
          line: 'feminino',
          variantIds: [s.zoneId],
          period: 'tarde',
          time: '14:00',
          date: '2026-11-06',
          catalogVersion: s.catalog.version,
        },
        s.clock,
      )
      s.clock.set(s.clock.nowMs() + 60_000)
      setServiceActiveOp(s.db, s.caller, s.svc.id, false, s.clock)
      clearCompiledCatalogCache(s.db)
      const next = getOrCompileCatalog(s.db, s.tenantId, s.clock)
      expect(next.version).not.toBe(s.catalog.version)
      const synced = syncBookingFrameWithCatalog(
        s.db,
        s.tenantId,
        s.conversationId,
        {
          version: next.version,
          serviceIds: new Set(next.services.map((x) => x.id)),
          variantIds: new Set(next.services.flatMap((x) => x.zones.map((z) => z.id))),
          professionalIds: new Set(
            next.resources.filter((r) => r.kind === 'professional').map((r) => r.id),
          ),
        },
        s.clock,
      )
      expect(synced.revalidated).toBe(true)
      expect(synced.frame).toBeNull()
      expect(getBookingFrame(s.db, s.tenantId, s.conversationId)).toBeNull()
    } finally {
      s.close()
    }
  })

  it('sessão migrada (catalog_version="") com dados válidos → mantém slots e grava versão', () => {
    const s = seedCatalog()
    try {
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.conversationId,
        {
          serviceId: s.svc.id,
          line: 'feminino',
          variantIds: [s.zoneId],
          period: 'tarde',
          time: '14:00',
          date: '2026-11-06',
          catalogVersion: '',
        },
        s.clock,
      )
      expect(getBookingFrame(s.db, s.tenantId, s.conversationId)?.catalogVersion).toBe('')
      const catalog = getOrCompileCatalog(s.db, s.tenantId, s.clock)
      const synced = syncBookingFrameWithCatalog(
        s.db,
        s.tenantId,
        s.conversationId,
        {
          version: catalog.version,
          serviceIds: new Set(catalog.services.map((x) => x.id)),
          variantIds: new Set(catalog.services.flatMap((x) => x.zones.map((z) => z.id))),
          professionalIds: new Set(
            catalog.resources.filter((r) => r.kind === 'professional').map((r) => r.id),
          ),
        },
        s.clock,
      )
      expect(synced.revalidated).toBe(true)
      const frame = synced.frame!
      expect(frame.serviceId).toBe(s.svc.id)
      expect(frame.line).toBe('feminino')
      expect(frame.variantIds).toEqual([s.zoneId])
      expect(frame.period).toBe('tarde')
      expect(frame.time).toBe('14:00')
      expect(frame.date).toBe('2026-11-06')
      expect(frame.catalogVersion).toBe(catalog.version)
      expect(wouldAskFilledSlot(frame, 'serviceId')).toBe(true)
      expect(wouldAskFilledSlot(frame, 'period')).toBe(true)
      expect(wouldAskFilledSlot(frame, 'time')).toBe(true)
      // Segunda passagem: versão igual → sem pergunta repetida / sem revalidação.
      const again = syncBookingFrameWithCatalog(
        s.db,
        s.tenantId,
        s.conversationId,
        {
          version: catalog.version,
          serviceIds: new Set(catalog.services.map((x) => x.id)),
          variantIds: new Set(catalog.services.flatMap((x) => x.zones.map((z) => z.id))),
          professionalIds: new Set(
            catalog.resources.filter((r) => r.kind === 'professional').map((r) => r.id),
          ),
        },
        s.clock,
      )
      expect(again.revalidated).toBe(false)
      expect(again.frame?.time).toBe('14:00')
    } finally {
      s.close()
    }
  })

  it('loadTurnContext sincroniza versão vazia sem perder serviço válido', () => {
    const s = seedCatalog()
    try {
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.conversationId,
        {
          serviceId: s.svc.id,
          line: 'feminino',
          period: 'manha',
          catalogVersion: '',
        },
        s.clock,
      )
      const contact = s.db.get<{ id: string }>(
        `SELECT contact_id AS id FROM conversations WHERE id = ?`,
        s.conversationId,
      )!
      const turn = loadTurnContext(
        s.db,
        s.tenantId,
        {
          conversationId: s.conversationId,
          contactId: contact.id,
          messageId: 'msg-sync',
        },
        s.clock,
      )
      expect(turn.session?.serviceId).toBe(s.svc.id)
      expect(turn.session?.audienceLine).toBe('feminino')
      const frame = getBookingFrame(s.db, s.tenantId, s.conversationId)!
      expect(frame.catalogVersion).toBe(readCatalogVersion(s.db, s.tenantId))
      expect(frame.period).toBe('manha')
    } finally {
      s.close()
    }
  })

  it('CF-45: a audiência solta (DEC-142) segue ao escolher o serviço; só uma troca de serviço a descarta', () => {
    const { db, clock, tenantId, conversationId, close } = boot()
    try {
      // Consulta de catálogo: só a linha, sem serviço.
      saveBookingFrame(db, tenantId, conversationId, { serviceId: null, line: 'masculino', catalogVersion: '1' }, clock)
      expect(heldAudienceLine(getBookingFrame(db, tenantId, conversationId))).toBe('masculino')
      // Escolhe o serviço sem repetir a linha: a audiência fica.
      const chosen = saveBookingFrame(db, tenantId, conversationId, { serviceId: 'svc1', catalogVersion: '1' }, clock)
      expect(chosen.frame.serviceId).toBe('svc1')
      expect(chosen.frame.line).toBe('masculino')
      // Já não é «solta»: com serviço, o helper não a devolve.
      expect(heldAudienceLine(getBookingFrame(db, tenantId, conversationId))).toBeNull()
      // Trocar para outro serviço continua a descartar a linha do primeiro.
      const other = saveBookingFrame(db, tenantId, conversationId, { serviceId: 'svc2', catalogVersion: '1' }, clock)
      expect(other.frame.line).toBeNull()
    } finally {
      close()
    }
  })

  it('heldAudienceLine: nulo sem quadro, com serviço ou sem linha', () => {
    expect(heldAudienceLine(null)).toBeNull()
    expect(heldAudienceLine({ serviceId: 'svc1', line: 'feminino' })).toBeNull()
    expect(heldAudienceLine({ serviceId: null, line: null })).toBeNull()
    expect(heldAudienceLine({ serviceId: null, line: 'feminino' })).toBe('feminino')
  })
})
