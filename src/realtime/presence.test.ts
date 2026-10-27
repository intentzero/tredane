import { describe, expect, it } from 'vitest'
import { PRESENCE_TTL_MS, activeViewerUserIds, parseClientMessage, type SocketAttachment } from './protocol'
import { presenceFrame } from '../client/panel/realtime/connection'

const base: SocketAttachment = {
  connectionId: 'c1',
  clerkUserId: 'u1',
  sessionId: 's',
  role: 'owner',
  tenantId: 't',
  authEpoch: 0,
  connectedAt: 0,
}

describe('presença WS (supressão de push com app aberta)', () => {
  it('parse da mensagem presence', () => {
    expect(parseClientMessage(presenceFrame(true))).toEqual({ v: 1, type: 'presence', visible: true })
    expect(parseClientMessage(presenceFrame(false))).toEqual({ v: 1, type: 'presence', visible: false })
  })
  it('só conta visível com report recente', () => {
    const now = 1_000_000
    const ids = activeViewerUserIds(
      [
        { ...base, clerkUserId: 'vis', visible: true, presenceAt: now - 1000 },
        { ...base, clerkUserId: 'stale', visible: true, presenceAt: now - PRESENCE_TTL_MS - 1 },
        { ...base, clerkUserId: 'hidden', visible: false, presenceAt: now },
        { ...base, clerkUserId: 'never' },
        null,
      ],
      now,
    )
    expect(ids).toEqual(['vis'])
  })
})
