// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClinicConfigSnapshot, PanelApi } from '../../api'

vi.mock('../../routes', () => ({ navigatePanel: vi.fn() }))

import { ClinicHoursScreen } from './ClinicHoursScreen'
import { ProfessionalExtras } from './ResourceExtras'

afterEach(cleanup)

const win = (resourceId: string, dayOfWeek: number, startMinute: number, endMinute: number) => ({
  id: `${resourceId}-${dayOfWeek}`, resourceId, dayOfWeek, startMinute, endMinute,
})

function snap(): ClinicConfigSnapshot {
  return {
    settings: { timezone: 'America/Sao_Paulo' },
    services: [
      { id: 's1', name: 'Limpeza de pele', active: true, durationMinutes: 60, bufferMinutes: 15, occupiedMinutes: 75,
        priceCents: null, clientExplanation: null, requiresSignal: false, signalKind: null, signalFixedCents: null,
        signalPercent: null, professionalIds: ['p1'], roomRequirement: { mode: 'none' }, createdAt: 0, updatedAt: 0 },
      { id: 's2', name: 'Peeling', active: true, durationMinutes: 45, bufferMinutes: 0, occupiedMinutes: 45,
        priceCents: null, clientExplanation: null, requiresSignal: false, signalKind: null, signalFixedCents: null,
        signalPercent: null, professionalIds: [], roomRequirement: { mode: 'none' }, createdAt: 0, updatedAt: 0 },
    ],
    resources: [
      { id: 'p1', kind: 'professional', name: 'Ana', category: null, active: true, hoursMode: 'clinic', futureAppointmentCount: 0, hasAppointmentHistory: false },
      { id: 'p2', kind: 'professional', name: 'Bia', category: null, active: true, hoursMode: 'own', futureAppointmentCount: 0, hasAppointmentHistory: false },
    ],
    weeklyWindows: [
      ...[1, 2, 3, 4, 5].map((d) => win('__clinic__', d, 480, 1080)),
      win('p2', 1, 840, 1080),
    ],
    blocks: [],
    readiness: { missing: [], counts: {} },
  } as unknown as ClinicConfigSnapshot
}

function api(): PanelApi {
  return {
    setWeeklyWindows: vi.fn(async () => ({ windows: [] })),
    upsertService: vi.fn(async () => ({})),
    upsertResource: vi.fn(async () => ({})),
    createBlock: vi.fn(async () => ({ created: false, block: null, affectedAppointments: [] })),
    deleteBlock: vi.fn(async () => undefined),
  } as unknown as PanelApi
}

describe('Horário da clínica', () => {
  it('abre o sábado e salva o horário no escopo da clínica; mostra quem tem horário próprio', async () => {
    const a = api()
    const onSaved = vi.fn(async () => undefined)
    render(<ClinicHoursScreen tenantId="t" snap={snap()} api={a} generation={1} onSaved={onSaved} />)
    expect(screen.getByText('1 profissional segue este horário.')).toBeTruthy()
    expect(screen.getAllByText('Bia').length).toBeGreaterThan(1)
    expect(screen.getByText('Seg 14:00–18:00')).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: 'Sábado: fechado' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar horário' }))
    await waitFor(() => expect(a.setWeeklyWindows).toHaveBeenCalled())
    const [, scope, windows] = (a.setWeeklyWindows as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(scope).toBe('__clinic__')
    expect(windows).toContainEqual({ dayOfWeek: 6, startMinute: 480, endMinute: 1080 })
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('o calendário junta fechamentos da clínica e folgas das pessoas numa lista só', () => {
    const s = snap()
    const day = 86_400_000
    const t0 = Date.now() + 5 * day
    s.blocks = [
      { id: 'b1', resourceId: '__clinic__', startsAt: t0, endsAt: t0 + day, reason: 'feriado' },
      { id: 'b2', resourceId: 'p2', startsAt: t0 + 3 * day, endsAt: t0 + 4 * day, reason: 'folga' },
    ] as unknown as ClinicConfigSnapshot['blocks']
    render(<ClinicHoursScreen tenantId="t" snap={s} api={api()} generation={1} onSaved={async () => undefined} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Calendário' }))
    expect(screen.getByText(/Clínica fechada · Feriado/)).toBeTruthy()
    expect(screen.getByText(/Bia · Folga/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^Remover/ })).toHaveLength(2)
  })

  it('fechar a clínica mostra o impacto antes de salvar e cria o bloqueio no escopo da clínica', async () => {
    const a = api()
    ;(a.createBlock as ReturnType<typeof vi.fn>).mockImplementation(async (_t: string, body: { dryRun?: boolean }) =>
      body.dryRun
        ? { created: false, block: null, affectedAppointments: [{ id: 'a1', contactLabel: 'Carla', startsAt: Date.UTC(2026, 10, 15, 13), endsAt: Date.UTC(2026, 10, 15, 14), status: 'confirmed' }] }
        : { created: true, block: {}, affectedAppointments: [] },
    )
    render(<ClinicHoursScreen tenantId="t" snap={snap()} api={a} generation={1} onSaved={async () => undefined} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Calendário' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Folga, férias ou fechamento' }))
    const [from, to] = Array.from(document.querySelectorAll('input[type="date"]')) as HTMLInputElement[]
    fireEvent.change(from!, { target: { value: '2026-11-15' } })
    fireEvent.change(to!, { target: { value: '2026-11-15' } })
    expect(await screen.findByText('1 horário marcado nesse período')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(a.createBlock).toHaveBeenLastCalledWith(
        't',
        expect.objectContaining({ resourceId: '__clinic__', reason: 'feriado' }),
        expect.anything(),
      ),
    )
    const last = (a.createBlock as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1]
    expect(last.dryRun).toBeUndefined()
  })
})

describe('Ficha da profissional', () => {
  it('chip de serviço grava a lista de quem faz o serviço, preservando o resto', async () => {
    const a = api()
    const s = snap()
    render(
      <ProfessionalExtras
        resource={s.resources[0]!}
        tenantId="t"
        snap={s}
        api={a}
        generation={1}
        onSaved={async () => undefined}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Peeling' }))
    await waitFor(() => expect(a.upsertService).toHaveBeenCalled())
    const [, body, opts] = (a.upsertService as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(opts.serviceId).toBe('s2')
    expect(body.professionalIds).toEqual(['p1'])
    expect(body.durationMinutes).toBe(45)
  })

  it('«Horário próprio» copia o da clínica antes de trocar o modo', async () => {
    const a = api()
    const s = snap()
    render(
      <ProfessionalExtras resource={s.resources[0]!} tenantId="t" snap={s} api={a} generation={1} onSaved={async () => undefined} />,
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Horário' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Horário próprio' }))
    await waitFor(() => expect(a.upsertResource).toHaveBeenCalled())
    const [, scope, windows] = (a.setWeeklyWindows as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(scope).toBe('p1')
    expect(windows).toHaveLength(5)
    expect((a.upsertResource as ReturnType<typeof vi.fn>).mock.calls[0]![1].hoursMode).toBe('own')
  })
})
