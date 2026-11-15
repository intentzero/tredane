import { describe, expect, it } from 'vitest'
import { MIGRATION_ID, MIGRATION_NAME } from './0071_conversation_misunderstanding_streak'

describe('0071_conversation_misunderstanding_streak', () => {
  it('ids estáveis', () => {
    expect(MIGRATION_ID).toBe(71)
    expect(MIGRATION_NAME).toBe('0071_conversation_misunderstanding_streak')
  })
})