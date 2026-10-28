import { describe, expect, it } from 'vitest'
import { describeResetResult } from './StagingResetCard'

describe('StagingResetCard — mensagens', () => {
  it('traduz respostas do servidor', () => {
    expect(describeResetResult(200, { ok: true, totalDeleted: 12 })).toContain('12 registros')
    expect(describeResetResult(404, { error: 'not_found' })).toContain('só staging')
    expect(describeResetResult(403, {})).toContain('dono')
    expect(describeResetResult(400, {})).toContain('nome')
  })
})
