import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { replaceServiceZonesOp, upsertServiceOp } from '../config'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { bootClinicDb } from '../test-db'
import {
  ACTIVE_CATALOG_SUBJECT_TTL_MS,
  clearActiveCatalogSubject,
  getActiveCatalogSubject,
  setActiveCatalogSubject,
} from './active-catalog-subject'
import { catalogReply } from './catalog-reply'
import { getScheduleSession } from './schedule-session'

const NOW = Date.parse('2026-11-21T15:00:00-03:00')

describe('ActiveCatalogSubject (DEC-223)', () => {
  it('isola por tenant_id + conversation_id', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    try {
      const a = upsertContact(
        boot.db,
        { tenantId: 'clinic-demo-a', waId: '551100000001', displayName: 'A' },
        clock,
      )
      const b = upsertContact(
        boot.db,
        { tenantId: 'clinic-demo-b', waId: '551100000002', displayName: 'B' },
        clock,
      )
      const cnvA = createConversation(boot.db, { tenantId: 'clinic-demo-a', contactId: a.id }, clock)
      const cnvB = createConversation(boot.db, { tenantId: 'clinic-demo-b', contactId: b.id }, clock)
      setActiveCatalogSubject(
        boot.db,
        'clinic-demo-a',
        cnvA.id,
        { serviceId: 'svc_a', variantIds: ['z1'], source: 'faq_offer' },
        clock,
      )
      setActiveCatalogSubject(
        boot.db,
        'clinic-demo-b',
        cnvB.id,
        { serviceId: 'svc_b', variantIds: [], source: 'price' },
        clock,
      )
      expect(getActiveCatalogSubject(boot.db, 'clinic-demo-a', cnvA.id)?.serviceId).toBe('svc_a')
      expect(getActiveCatalogSubject(boot.db, 'clinic-demo-b', cnvB.id)?.serviceId).toBe('svc_b')
      expect(getActiveCatalogSubject(boot.db, 'clinic-demo-a', cnvB.id)).toBeNull()
      expect(getActiveCatalogSubject(boot.db, 'clinic-demo-b', cnvA.id)).toBeNull()
    } finally {
      boot.close()
    }
  })

  it('expira após TTL 24 h', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    try {
      const contact = upsertContact(
        boot.db,
        { tenantId: 'clinic-demo-ttl', waId: '551100000003', displayName: 'T' },
        clock,
      )
      const cnv = createConversation(
        boot.db,
        { tenantId: 'clinic-demo-ttl', contactId: contact.id },
        clock,
      )
      setActiveCatalogSubject(
        boot.db,
        'clinic-demo-ttl',
        cnv.id,
        { serviceId: 'svc_x', source: 'faq_offer' },
        clock,
      )
      clock.advance(ACTIVE_CATALOG_SUBJECT_TTL_MS + 1)
      expect(
        getActiveCatalogSubject(boot.db, 'clinic-demo-ttl', cnv.id, { nowMs: clock.nowMs() }),
      ).toBeNull()
    } finally {
      boot.close()
    }
  })

  it('FAQ oferta grava sujeito informativo; «Qual o valor?» lê preço; booking variantIds vazio', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const tenantId = 'clinic-demo-acs-price'
    const caller = workerCaller(tenantId)
    try {
      const svc = upsertServiceOp(
        boot.db,
        caller,
        {
          name: 'Massagem',
          durationMinutes: 60,
          bufferMinutes: 0,
          priceCents: null,
          variantKind: 'Tipo',
          variantKindPlural: 'Tipos',
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
            name: 'Massagem relaxante',
            audience: 'ambos',
            durationMinutes: 60,
            priceCents: 20_000,
          },
        ],
        clock,
      )
      const contact = upsertContact(
        boot.db,
        { tenantId, waId: '5511999000130', displayName: 'Cliente' },
        clock,
      )
      const conversation = createConversation(boot.db, { tenantId, contactId: contact.id }, clock)

      const offer = catalogReply(boot.db, tenantId, 'Fazem massagem relaxante?', clock, {
        conversationId: conversation.id,
      })
      expect(offer).toMatch(/Sim, fazemos Massagem relaxante/i)
      expect(getScheduleSession(boot.db, tenantId, conversation.id)?.variantIds ?? []).toEqual([])
      const subject = getActiveCatalogSubject(boot.db, tenantId, conversation.id, {
        nowMs: clock.nowMs(),
      })
      expect(subject?.serviceId).toBe(svc.id)
      expect(subject?.variantIds).toHaveLength(1)
      expect(subject?.source).toBe('faq_offer')

      const price = catalogReply(boot.db, tenantId, 'Qual o valor?', clock, {
        conversationId: conversation.id,
      })
      expect(price).toMatch(/200/)
      expect(price).not.toMatch(/equipe confirma|não tenho/i)
      expect(getScheduleSession(boot.db, tenantId, conversation.id)?.variantIds ?? []).toEqual([])
    } finally {
      boot.close()
    }
  })

  it('substitui o sujeito quando a cliente nomeia outro serviço', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    const tenantId = 'clinic-demo-acs-swap'
    const caller = workerCaller(tenantId)
    try {
      const massagem = upsertServiceOp(
        boot.db,
        caller,
        {
          name: 'Massagem',
          durationMinutes: 60,
          bufferMinutes: 0,
          priceCents: 15_000,
          professionalIds: [],
          roomRequirement: { mode: 'none' },
        },
        clock,
      )
      const limpeza = upsertServiceOp(
        boot.db,
        caller,
        {
          name: 'Limpeza de pele',
          durationMinutes: 45,
          bufferMinutes: 0,
          priceCents: 18_000,
          professionalIds: [],
          roomRequirement: { mode: 'none' },
        },
        clock,
      )
      const contact = upsertContact(
        boot.db,
        { tenantId, waId: '5511999000131', displayName: 'Cliente' },
        clock,
      )
      const conversation = createConversation(boot.db, { tenantId, contactId: contact.id }, clock)

      catalogReply(boot.db, tenantId, 'Fazem massagem?', clock, {
        conversationId: conversation.id,
      })
      expect(getActiveCatalogSubject(boot.db, tenantId, conversation.id)?.serviceId).toBe(
        massagem.id,
      )

      catalogReply(boot.db, tenantId, 'Fazem limpeza de pele?', clock, {
        conversationId: conversation.id,
      })
      expect(getActiveCatalogSubject(boot.db, tenantId, conversation.id)?.serviceId).toBe(
        limpeza.id,
      )

      const price = catalogReply(boot.db, tenantId, 'Qual o valor?', clock, {
        conversationId: conversation.id,
      })
      expect(price).toMatch(/18/)
    } finally {
      boot.close()
    }
  })

  it('clear remove o sujeito', () => {
    const clock = createControllableClock(NOW)
    const boot = bootClinicDb({ clock })
    try {
      const contact = upsertContact(
        boot.db,
        { tenantId: 'clinic-demo-acs-clear', waId: '551100000004', displayName: 'C' },
        clock,
      )
      const cnv = createConversation(
        boot.db,
        { tenantId: 'clinic-demo-acs-clear', contactId: contact.id },
        clock,
      )
      setActiveCatalogSubject(
        boot.db,
        'clinic-demo-acs-clear',
        cnv.id,
        { serviceId: 'svc', source: 'faq_offer' },
        clock,
      )
      clearActiveCatalogSubject(boot.db, 'clinic-demo-acs-clear', cnv.id)
      expect(getActiveCatalogSubject(boot.db, 'clinic-demo-acs-clear', cnv.id)).toBeNull()
    } finally {
      boot.close()
    }
  })
})
