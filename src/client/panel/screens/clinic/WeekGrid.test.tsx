import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { blockRange, toWeekDraft } from './clinicHours'
import { WeekGrid } from './WeekGrid'

const TZ = 'America/Sao_Paulo'
const w = (dayOfWeek: number, startMinute: number, endMinute: number) => ({
  id: `${dayOfWeek}-${startMinute}`, resourceId: 'r', dayOfWeek, startMinute, endMinute,
})
// Segunda 2/11/2026 (hoje); semana de 2 a 8 de novembro.
const clinic = toWeekDraft([1, 2, 3, 4, 5].map((d) => w(d, 480, 1080)))
const closure = blockRange('2026-11-03', '2026-11-03', true, 0, 0, TZ)!
const base = {
  clinic,
  people: [
    { id: 'p1', name: 'Paula', color: '#2563A8', week: clinic },
    { id: 'p2', name: 'Lívia', color: '#2F7D4F', week: toWeekDraft([w(2, 600, 1140)]) },
  ],
  clinicBlocks: [{ id: 'b1', resourceId: '__clinic__', ...closure }],
  personBlocks: [],
  timezone: TZ,
  todayIso: '2026-11-02',
  selectedDay: null as number | null,
  onPickDay: () => {},
}

describe('WeekGrid', () => {
  it('mostra a semana, o fechamento e navega entre semanas', () => {
    render(<WeekGrid {...base} />)
    expect(screen.getByText('2 a 8 de novembro')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Terça, 03\/11.*com fechamento/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Segunda, 02\/11, 08:00 às 18:00\. Editar/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Próxima semana' }))
    expect(screen.getByText('9 a 15 de novembro')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /com fechamento/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Hoje' }))
    expect(screen.getByText('2 a 8 de novembro')).toBeTruthy()
  })

  it('«Mostrar» liga e desliga as faixas de cada pessoa', () => {
    const { container } = render(<WeekGrid {...base} />)
    expect(container.querySelectorAll('[data-person="p2"]').length).toBe(7)
    fireEvent.click(screen.getByRole('button', { name: 'Lívia' }))
    expect(container.querySelectorAll('[data-person="p2"]').length).toBe(0)
    expect(container.querySelectorAll('[data-person="p1"]').length).toBe(7)
  })

  it('escolher um dia entrega o dia da semana', () => {
    const onPickDay = vi.fn()
    render(<WeekGrid {...base} onPickDay={onPickDay} />)
    fireEvent.click(screen.getByRole('button', { name: /^Quarta, 04\/11/ }))
    expect(onPickDay).toHaveBeenCalledWith(3)
  })
})
