/**
 * DEC-077 / S3 — bloco Tempo no serviço. A agenda ainda não filtra.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { ValidationError, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { upsertResourceOp, upsertServiceOp } from './index'
import { buildAiContextPayload } from '../ai/context'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { upsertContact } from '../contacts'

describe('bloco Tempo no serviço (S3)', () => {
  it('não infere pelo nome, limpa os graus e não entra no catálogo da IA', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 1))
    const { db, close } = bootClinicDb({ clock })
    try {
      const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
      const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi' }, clock)
      const base = {
        durationMinutes: 60,
        bufferMinutes: 0,
        professionalIds: [pro.id],
        roomRequirement: { mode: 'none' as const },
      }
      const dep = upsertServiceOp(db, caller, { ...base, name: 'Depilação' }, clock)
      expect(dep).toMatchObject({
        tempoCeu: 'tanto_faz',
        tempoTemperatura: 'tanto_faz',
        tempoCelsius: null,
      })

      const bronze = upsertServiceOp(
        db,
        caller,
        { ...base, name: 'Bronzeamento', tempoCeu: 'sol', tempoTemperatura: 'acima', tempoCelsius: 24 },
        clock,
      )
      expect(bronze).toMatchObject({
        tempoCeu: 'sol',
        tempoTemperatura: 'acima',
        tempoCelsius: 24,
      })

      const renamed = upsertServiceOp(
        db,
        caller,
        { ...base, id: dep.id, name: 'Bronzeamento express' },
        clock,
      )
      expect(renamed).toMatchObject({
        tempoCeu: 'tanto_faz',
        tempoTemperatura: 'tanto_faz',
        tempoCelsius: null,
      })

      expect(() =>
        upsertServiceOp(
          db,
          caller,
          { ...base, id: bronze.id, name: bronze.name, tempoTemperatura: 'acima', tempoCelsius: null },
          clock,
        ),
      ).toThrow(ValidationError)
      expect(() =>
        upsertServiceOp(
          db,
          caller,
          { ...base, id: bronze.id, name: bronze.name, tempoTemperatura: 'acima', tempoCelsius: 24.5 },
          clock,
        ),
      ).toThrow(ValidationError)

      const cleared = upsertServiceOp(
        db,
        caller,
        { ...base, id: bronze.id, name: bronze.name, tempoTemperatura: 'tanto_faz' },
        clock,
      )
      expect(cleared).toMatchObject({
        tempoCeu: 'sol',
        tempoTemperatura: 'tanto_faz',
        tempoCelsius: null,
      })

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
          body: 'quero bronzeamento',
          externalMessageId: 'wamid_tempo_1',
          deliveryState: 'received',
        },
        clock,
      )
      const built = buildAiContextPayload(db, 'clinic-demo-a', conv.id)
      const raw = JSON.stringify(built.payload)
      expect(raw).not.toMatch(/tempo_ceu|tempoCeu|tempoCelsius|tempo_celsius|percentagem/)
      expect(built.payload.services.map((s) => s.name).sort()).toEqual([
        'Bronzeamento',
        'Bronzeamento express',
      ])
    } finally {
      close()
    }
  })
})
