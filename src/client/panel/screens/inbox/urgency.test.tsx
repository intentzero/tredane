import { describe, expect, it } from 'vitest'
import type { InboxConversation } from '../../api'
import { groupByUrgency, isWaitingOnTeam, urgencyGroup, waitingLabel } from './urgency'

function conv(over: Partial<InboxConversation>): InboxConversation {
  return {
    id: over.id ?? 'c1',
    tenantId: 't1',
    contactId: 'k1',
    status: 'open',
    assigneeClerkUserId: 'u1',
    assigneeDisplayName: 'Ana',
    assignmentVersion: 1,
    lastMessageAt: 1_000,
    lastMessagePreview: 'oi',
    lastMessageDirection: 'outbound',
    unreadCount: 0,
    createdAt: 0,
    updatedAt: 0,
    contact: { id: 'k1' } as InboxConversation['contact'],
    ...over,
  }
}

describe('urgencyGroup (DEC-162)', () => {
  it('sem responsável vem primeiro, mesmo com resposta da equipe', () => {
    expect(urgencyGroup(conv({ assigneeClerkUserId: null, status: 'new' }))).toBe('unassigned')
  })
  it('com responsável e última mensagem da cliente espera resposta', () => {
    expect(urgencyGroup(conv({ lastMessageDirection: 'inbound' }))).toBe('waiting')
  })
  it('equipe falou por último fica em dia', () => {
    expect(urgencyGroup(conv({ lastMessageDirection: 'outbound' }))).toBe('ok')
  })
  it('encerrada fica em dia, mesmo sem responsável', () => {
    expect(urgencyGroup(conv({ status: 'closed', assigneeClerkUserId: null }))).toBe('ok')
  })
})

describe('groupByUrgency', () => {
  it('ordena os grupos e omite os vazios, mantendo a ordem da API', () => {
    const groups = groupByUrgency([
      conv({ id: 'a', lastMessageDirection: 'outbound' }),
      conv({ id: 'b', lastMessageDirection: 'inbound' }),
      conv({ id: 'c', assigneeClerkUserId: null }),
      conv({ id: 'd', lastMessageDirection: 'inbound' }),
    ])
    expect(groups.map((g) => [g.group, g.items.map((i) => i.id)])).toEqual([
      ['unassigned', ['c']],
      ['waiting', ['b', 'd']],
      ['ok', ['a']],
    ])
  })
})

describe('espera', () => {
  it('só quando a cliente falou por último numa conversa aberta', () => {
    expect(isWaitingOnTeam(conv({ lastMessageDirection: 'inbound' }))).toBe(true)
    expect(isWaitingOnTeam(conv({ lastMessageDirection: 'outbound' }))).toBe(false)
    expect(isWaitingOnTeam(conv({ lastMessageDirection: 'inbound', status: 'closed' }))).toBe(false)
  })
  it('formata minutos, horas e dias', () => {
    const now = 10 * 86_400_000
    expect(waitingLabel(now - 30_000, now)).toBe('espera agora')
    expect(waitingLabel(now - 12 * 60_000, now)).toBe('espera há 12 min')
    expect(waitingLabel(now - 5 * 3_600_000, now)).toBe('espera há 5 h')
    expect(waitingLabel(now - 15 * 86_400_000 + 1, now - 0)).toBe('espera há 14 d')
  })
})
