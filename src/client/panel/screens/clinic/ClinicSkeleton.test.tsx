import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClinicSkeleton } from './ClinicSkeleton'

describe('ClinicSkeleton (DEC-175)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('anuncia a carga logo, mas só desenha o esqueleto depois de 300 ms', () => {
    vi.useFakeTimers()
    const { container } = render(<ClinicSkeleton shape="table" label="Carregando Serviços" />)
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByText('Carregando Serviços').className).toContain('panel-sr-only')
    expect(container.querySelector('.clinic-skeleton-body')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(container.querySelector('.clinic-skeleton-body')).toBeTruthy()
    expect(container.querySelectorAll('.clinic-sk-row')).toHaveLength(5)
    expect(container.querySelector('.panel-spin')).toBeNull()
  })

  it('tem a forma de cada tela', () => {
    const { container, rerender } = render(
      <ClinicSkeleton shape="connection" label="Carregando WhatsApp" delayMs={0} />,
    )
    expect(container.querySelector('.clinic-sk-banner')).toBeTruthy()
    expect(container.querySelectorAll('.clinic-sk-avatar--icon')).toHaveLength(3)
    rerender(<ClinicSkeleton shape="week" label="Carregando Horário" delayMs={0} />)
    expect(container.querySelectorAll('.clinic-sk-bar')).toHaveLength(7)
  })
})
