import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { bootClinicDb } from '../test-db'
import {
  upsertKnowledgeCategory,
  upsertKnowledgeEntry,
} from '../config/knowledge'
import { answerClinicKnowledge, looksLikeKnowledgeAsk } from './clinic-knowledge-reply'

describe('clinic-knowledge-reply (DEC-185)', () => {
  it('reconhece pergunta e devolve texto cadastrado', () => {
    const { db, close } = bootClinicDb()
    const clock = createControllableClock(Date.UTC(2026, 10, 14, 15))
    try {
      const tenantId = 'ten_kn_reply'
      const cat = upsertKnowledgeCategory(db, tenantId, { name: 'Acesso' }, clock)
      upsertKnowledgeEntry(
        db,
        tenantId,
        {
          categoryId: cat.id,
          question: 'Tem estacionamento?',
          answer: 'Sim, há vagas na rua.',
          matchCues: ['estacionamento'],
          status: 'published',
        },
        'owner',
        clock,
      )
      expect(looksLikeKnowledgeAsk('Vocês têm estacionamento?')).toBe(true)
      const hit = answerClinicKnowledge(db, tenantId, 'Vocês têm estacionamento?')
      expect(hit?.replyText).toBe('Sim, há vagas na rua.')
      expect(answerClinicKnowledge(db, tenantId, 'quero axila')).toBeNull()
    } finally {
      close()
    }
  })
})
