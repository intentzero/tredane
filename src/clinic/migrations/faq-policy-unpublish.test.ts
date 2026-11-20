import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { bootClinicDb } from '../test-db'
import { upsertKnowledgeCategory, upsertKnowledgeEntry } from '../config/knowledge'
import { CLINIC_SCHEMA_VERSION } from '../constants'
import { MIGRATION_ID, STATEMENTS } from './0078_faq_policy_and_ai_booking_limits'

describe('migração 78 — FAQ de política em rascunho e limites de marcação pela IA fora', () => {
  it('despublica só as FAQ escritas à mão sobre sinal, multa, cancelar ou remarcar', () => {
    expect(CLINIC_SCHEMA_VERSION).toBeGreaterThanOrEqual(MIGRATION_ID)
    const clock = createControllableClock(Date.UTC(2026, 10, 19, 12))
    const { db, close } = bootClinicDb({ clock })
    try {
      const tenant = 'clinic-demo-a'
      const cat = upsertKnowledgeCategory(db, tenant, { name: 'Geral', sortOrder: 1 }, clock)
      const add = (question: string, cues: string[]) =>
        upsertKnowledgeEntry(
          db,
          tenant,
          { categoryId: cat.id, question, answer: 'Resposta fictícia.', matchCues: cues, status: 'published' },
          'user_synth_owner_a',
          clock,
        )
      const sinal = add('Como funciona o sinal?', ['sinal'])
      const multa = add('Tem multa se eu faltar?', [])
      const parking = add('Tem estacionamento?', ['estacionamento'])
      // Reaplica o UPDATE da migração (o banco de teste já está na versão final).
      db.run(STATEMENTS[0])
      const status = (id: string) =>
        db.get<{ status: string }>('SELECT status FROM clinic_knowledge_entries WHERE tenant_id = ? AND id = ?', tenant, id)?.status
      expect(status(sinal.id)).toBe('draft')
      expect(status(multa.id)).toBe('draft')
      expect(status(parking.id)).toBe('published')
      const cols = db.all<{ name: string }>('PRAGMA table_info(clinic_settings)').map((c) => c.name)
      expect(cols).not.toContain('abuse_ai_bookings_per_contact')
      expect(cols).not.toContain('abuse_ai_bookings_per_clinic')
    } finally {
      close()
    }
  })
})
