import { describe, expect, it } from 'vitest'
import { MIGRATION_ID, MIGRATION_NAME } from './0070_conversation_misunderstanding_streak'

describe('0070_conversation_misunderstanding_streak', () => {
  it('ids estáveis', () => {
    expect(MIGRATION_ID).toBe(70)
    expect(MIGRATION_NAME).toBe('0070_conversation_misunderstanding_streak')
  })
})