/**
 * DEC-075 / S2 — audiência do serviço.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { ValidationError, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { upsertResourceOp, upsertServiceOp } from './index'
import { buildAiContextPayload } from '../ai/context'
import { getContact } from '../contacts'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { upsertContact } from '../contacts'

describe('audiência do serviço (S2)', () => {
  it('cria com qualquer; renomear com «feminina» não inferir; owner grava feminino/masculino', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
      const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi' }, clock)
      const dep = upsertServiceOp(
        db,
        caller,
        {
          name: 'Depilação',
          durationMinutes: 30,
          bufferMinutes: 0,
          professionalIds: [pro.id],
          roomRequirement: { mode: 'none' },
        },
        clock,
      )
      expect(dep.audiencia).toBe('qualquer')

      const renamed = upsertServiceOp(
        db,
        caller,
        {
          id: dep.id,
          name: 'Depilação feminina',
          durationMinutes: 30,
          bufferMinutes: 0,
          professionalIds: [pro.id],
          roomRequirement: { mode: 'none' },
        },
        clock,
      )
      expect(renamed.audiencia).toBe('qualquer')

      const fem = upsertServiceOp(
        db,
        caller,
        {
          name: 'Bronzeamento feminino',
          durationMinutes: 60,
          bufferMinutes: 0,
          audiencia: 'feminino',
          professionalIds: [pro.id],
          roomRequirement: { mode: 'none' },
        },
        clock,
      )
      const masc = upsertServiceOp(
        db,
        caller,
        {
          name: 'Bronzeamento masculino',
          durationMinutes: 60,
          bufferMinutes: 0,
          audiencia: 'masculino',
          professionalIds: [pro.id],
          roomRequirement: { mode: 'none' },
        },
        clock,
      )
      expect(fem.audiencia).toBe('feminino')
      expect(masc.audiencia).toBe('masculino')
      expect(fem.active && masc.active).toBe(true)

      expect(() =>
        upsertServiceOp(
          db,
          caller,
          {
            id: fem.id,
            name: fem.name,
            durationMinutes: 60,
            bufferMinutes: 0,
            audiencia: 'misto' as 'feminino',
            professionalIds: [pro.id],
            roomRequirement: { mode: 'none' },
          },
          clock,
        ),
      ).toThrow(ValidationError)

      const cols = db.all<{ name: string }>(`PRAGMA table_info(contacts)`)
      expect(cols.some((c) => /sexo|gender|sex/i.test(c.name))).toBe(false)
    } finally {
      close()
    }
  })

  it('catálogo da IA inclui audiência; pedido explícito filtra; contacto sem sexo', async () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
      const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Sandra' }, clock)
      upsertServiceOp(
        db,
        caller,
        {
          name: 'Depilação',
          durationMinutes: 30,
          bufferMinutes: 0,
          professionalIds: [pro.id],
          roomRequirement: { mode: 'none' },
        },
        clock,
      )
      upsertServiceOp(
        db,
        caller,
        {
          name: 'Bronzeamento feminino',
          durationMinutes: 60,
          bufferMinutes: 0,
          audiencia: 'feminino',
          professionalIds: [pro.id],
          roomRequirement: { mode: 'none' },
        },
        clock,
      )
      upsertServiceOp(
        db,
        caller,
        {
          name: 'Bronzeamento masculino',
          durationMinutes: 60,
          bufferMinutes: 0,
          audiencia: 'masculino',
          professionalIds: [pro.id],
          roomRequirement: { mode: 'none' },
        },
        clock,
      )

      const contact = upsertContact(
        db,
        { tenantId: 'clinic-demo-a', waId: '5511999000111', displayName: 'Ana Fictícia' },
        clock,
      )
      const conv = createConversation(
        db,
        { tenantId: 'clinic-demo-a', contactId: contact.id, status: 'open' },
        clock,
      )
      insertMessage(
        db,
        {
          tenantId: 'clinic-demo-a',
          conversationId: conv.id,
          direction: 'inbound',
          body: 'quero o bronzeamento feminino',
          externalMessageId: 'wamid_aud_1',
          deliveryState: 'received',
        },
        clock,
      )

      const built = await buildAiContextPayload(db, 'clinic-demo-a', conv.id)
      expect(built.payload.services.map((s) => s.name).sort()).toEqual([
        'Bronzeamento feminino',
        'Depilação',
      ])
      expect(built.payload.services.every((s) => s.audiencia === 'feminino' || s.audiencia === 'qualquer')).toBe(
        true,
      )
      expect(JSON.stringify(built.payload)).not.toMatch(/5511999000111/)
      const stored = getContact(db, 'clinic-demo-a', contact.id)
      expect(stored && !('sexo' in stored) && !('gender' in stored)).toBe(true)
    } finally {
      close()
    }
  })

  it('migração 31 deixa «Bronzeamento feminino» como qualquer', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
      const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi' }, clock)
      const svc = upsertServiceOp(
        db,
        caller,
        {
          name: 'Bronzeamento feminino',
          durationMinutes: 60,
          bufferMinutes: 0,
          professionalIds: [pro.id],
          roomRequirement: { mode: 'none' },
        },
        clock,
      )
      expect(svc.audiencia).toBe('qualquer')
      const row = db.get<{ audiencia: string; name: string }>(
        `SELECT name, audiencia FROM services WHERE id = ?`,
        svc.id,
      )
      expect(row).toEqual({ name: 'Bronzeamento feminino', audiencia: 'qualquer' })
    } finally {
      close()
    }
  })
})
