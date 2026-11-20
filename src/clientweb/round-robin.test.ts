import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../db/clock'
import { bootClinicDb } from '../clinic/test-db'
import {
  pickRoundRobinProfessional,
  readRrLastProfessional,
  writeRrLastProfessional,
} from './round-robin'

describe('pickRoundRobinProfessional (DEC-218)', () => {
  const ordered = ['pro-a', 'pro-b', 'pro-c'] as const

  it('com cursor nulo escolhe a primeira livre na ordem', () => {
    expect(pickRoundRobinProfessional(ordered, new Set(['pro-a', 'pro-b']), null)).toBe('pro-a')
  })

  it('avança para a seguinte livre depois da última atribuída', () => {
    expect(pickRoundRobinProfessional(ordered, new Set(['pro-a', 'pro-b', 'pro-c']), 'pro-a')).toBe(
      'pro-b',
    )
    expect(pickRoundRobinProfessional(ordered, new Set(['pro-a', 'pro-b', 'pro-c']), 'pro-b')).toBe(
      'pro-c',
    )
    expect(pickRoundRobinProfessional(ordered, new Set(['pro-a', 'pro-b', 'pro-c']), 'pro-c')).toBe(
      'pro-a',
    )
  })

  it('salta quem não está livre na hora (RR-3)', () => {
    expect(pickRoundRobinProfessional(ordered, new Set(['pro-a', 'pro-c']), 'pro-a')).toBe('pro-c')
    expect(pickRoundRobinProfessional(ordered, new Set(['pro-a']), 'pro-a')).toBe('pro-a')
  })

  it('devolve null se ninguém está livre', () => {
    expect(pickRoundRobinProfessional(ordered, new Set(), 'pro-a')).toBeNull()
    expect(pickRoundRobinProfessional([], new Set(['pro-a']), null)).toBeNull()
  })
})

describe('cursor client_web_rr_cursor', () => {
  it('lê e grava a última profissional por serviço (RR-1, RR-2)', () => {
    const clock = createControllableClock(Date.UTC(2024, 0, 8, 12))
    const { db, close } = bootClinicDb({ clock })
    try {
      expect(readRrLastProfessional(db, 't1', 'svc-1')).toBeNull()
      writeRrLastProfessional(db, 't1', 'svc-1', 'pro-gi', clock)
      expect(readRrLastProfessional(db, 't1', 'svc-1')).toBe('pro-gi')
      writeRrLastProfessional(db, 't1', 'svc-1', 'pro-paula', clock)
      expect(readRrLastProfessional(db, 't1', 'svc-1')).toBe('pro-paula')
      expect(readRrLastProfessional(db, 't1', 'svc-outro')).toBeNull()
    } finally {
      close()
    }
  })
})
