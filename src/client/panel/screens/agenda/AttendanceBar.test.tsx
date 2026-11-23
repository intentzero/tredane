// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgendaAppointmentItem } from '../../api'
import { AgendaDayList } from './AgendaDayList'
import { AttendanceBar, attendancePending } from './AttendanceBar'
import { buildDayEntries } from './dayList'

const H = 3_600_000
const BASE = Date.UTC(2026, 10, 19, 12, 0, 0)

function apt(id: string, startH: number, attendance: AgendaAppointmentItem['attendance'] = null) {
  return {
    id,
    serviceId: 's',
    serviceName: 'Depilação',
    professionalId: 'p',
    professionalName: 'Gi',
    roomResourceId: null,
    roomResourceName: null,
    startsAt: BASE + startH * H,
    endsAt: BASE + (startH + 1) * H,
    occupiesUntil: BASE + (startH + 1) * H,
    status: 'confirmed',
    contactLabel: `Cliente ${id}`,
    contactId: null,
    conversationId: null,
    opportunityId: null,
    version: 1,
    changeReason: null,
    attendance,
  } as AgendaAppointmentItem
}

afterEach(cleanup)

describe('presença por marcar', () => {
  it('só pede presença de quem já começou e ainda não foi marcado', () => {
    expect(attendancePending(apt('a', 0), BASE + H)).toBe(true)
    expect(attendancePending(apt('a', 2), BASE + H)).toBe(false)
    expect(attendancePending(apt('a', 0, 'arrived'), BASE + H)).toBe(false)
  })

  it('pendente mostra Chegou / Não veio; marcado mostra o estado e Desfazer', () => {
    const onSet = vi.fn()
    const { rerender } = render(<AttendanceBar item={apt('a', 0)} now={BASE + H} onSet={onSet} />)
    fireEvent.click(screen.getByRole('button', { name: 'Chegou' }))
    expect(onSet).toHaveBeenCalledWith('a', 'arrived')
    rerender(<AttendanceBar item={apt('a', 0, 'no_show')} now={BASE + H} onSet={onSet} />)
    expect(screen.getByText('Não veio')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }))
    expect(onSet).toHaveBeenCalledWith('a', null)
  })

  it('CSS: bloco com presença fica acima da linha «agora» (Chegou / Não veio clicáveis)', () => {
    const css = readFileSync(join(__dirname, '../../../ui/panel.css'), 'utf8')
    // Linha decorativa: não captura toque.
    expect(css).toMatch(/\.agenda-now\s*\{[^}]*pointer-events:\s*none/s)
    // Faixa de presença acima da linha (z-index 2 → wrap com presença em 3).
    expect(css).toMatch(/\.agenda-block-wrap--attendance\s*\{[^}]*z-index:\s*3/s)
    expect(css).toMatch(/\.agenda-now\s*\{[^}]*z-index:\s*2/s)
    expect(css).toMatch(/\.agenda-block-wrap\s*\{[^}]*z-index:\s*1/s)
  })

  it('lista do celular: horários já resolvidos recolhem e abrem num toque', () => {
    const items = [apt('a', 0, 'arrived'), apt('b', 1, 'arrived'), apt('c', 2, 'no_show'), apt('d', 5)]
    const entries = buildDayEntries(items, new Map(), BASE + 4 * H)
    render(
      <AgendaDayList
        entries={entries}
        holds={[]}
        professionals={[{ id: 'p', name: 'Gi' }]}
        timezone="UTC"
        now={BASE + 4 * H}
        onOpen={() => {}}
        onOpenHold={() => {}}
        canMarkAttendance
        onSetAttendance={() => {}}
      />,
    )
    expect(screen.queryByText('Cliente a')).toBeNull()
    expect(screen.getByText('Cliente d')).toBeTruthy()
    const toggle = screen.getByRole('button', {
      name: /3 anteriores · 2 chegaram, 1 não veio/,
    })
    fireEvent.click(toggle)
    expect(screen.getByText('Cliente a')).toBeTruthy()
  })
})
