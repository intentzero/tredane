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

const day = 86_400_000

async function editDay(name: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name},.*Editar$`) }))
  return await screen.findByRole('switch', { name: new RegExp(`^${name}:`) })
}

describe('Horário da clínica', () => {
  it('mostra o resumo, os sete dias e quem segue o horário; sem alteração não há barra de salvar', () => {
    render(<ClinicHoursScreen tenantId="t" snap={snap()} api={api()} generation={1} onSaved={async () => undefined} />)
    expect(screen.getByText('Seg–sex 08:00–18:00')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /Editar$/ })).toHaveLength(7)
    expect(screen.getByText(/Ana/)).toBeTruthy()
    expect(screen.getByText('Bia · horário próprio')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Salvar horário' })).toBeNull()
  })

  it('abre o sábado no editor do dia, só altera o rascunho e salva no escopo da clínica', async () => {
    const a = api()
    const onSaved = vi.fn(async () => undefined)
    render(<ClinicHoursScreen tenantId="t" snap={snap()} api={a} generation={1} onSaved={onSaved} />)
    const sw = await editDay('Sábado')
    expect(document.activeElement?.textContent).toBe('Sábado')
    fireEvent.click(sw)
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar a este dia' }))
    expect(a.setWeeklyWindows).not.toHaveBeenCalled()
    expect(await screen.findByText(/Sábado alterada, ainda não salva/)).toBeTruthy()
    expect(screen.getByText(/Vale também para Ana/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar horário' }))
    await waitFor(() => expect(a.setWeeklyWindows).toHaveBeenCalled())
    const [, scope, windows] = (a.setWeeklyWindows as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(scope).toBe('__clinic__')
    expect(windows).toContainEqual({ dayOfWeek: 6, startMinute: 480, endMinute: 1080 })
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('«Usar este horário também em» copia as faixas para os dias marcados, e Descartar volta ao salvo', async () => {
    const a = api()
    render(<ClinicHoursScreen tenantId="t" snap={snap()} api={a} generation={1} onSaved={async () => undefined} />)
    await editDay('Segunda')
    const [start] = screen.getAllByLabelText('Faixa 1, começa')
    fireEvent.change(start!, { target: { value: '09:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sábado' }))
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar a 2 dias' }))
    expect(await screen.findByText(/Seg, Sáb alterados, ainda não salva/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar horário' }))
    await waitFor(() => expect(a.setWeeklyWindows).toHaveBeenCalled())
    const windows = (a.setWeeklyWindows as ReturnType<typeof vi.fn>).mock.calls[0]![2]
    expect(windows).toContainEqual({ dayOfWeek: 1, startMinute: 540, endMinute: 1080 })
    expect(windows).toContainEqual({ dayOfWeek: 6, startMinute: 540, endMinute: 1080 })
  })

  it('descartar remove as alterações sem salvar', async () => {
    const a = api()
    render(<ClinicHoursScreen tenantId="t" snap={snap()} api={a} generation={1} onSaved={async () => undefined} />)
    fireEvent.click(await editDay('Sábado'))
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar a este dia' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Descartar' }))
    expect(screen.queryByRole('button', { name: 'Salvar horário' })).toBeNull()
    expect(a.setWeeklyWindows).not.toHaveBeenCalled()
  })

  it('não deixa aplicar faixas sobrepostas', async () => {
    render(<ClinicHoursScreen tenantId="t" snap={snap()} api={api()} generation={1} onSaved={async () => undefined} />)
    await editDay('Segunda')
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar faixa' }))
    fireEvent.change(screen.getByLabelText('Faixa 2, começa'), { target: { value: '10:00' } })
    expect(screen.getByText('As faixas do dia não podem se sobrepor.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Aplicar a este dia' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('lista folgas e fechamentos na mesma página e pede confirmação antes de remover', async () => {
    const s = snap()
    const t0 = Date.now() + 5 * day
    s.blocks = [
      { id: 'b1', resourceId: '__clinic__', startsAt: t0, endsAt: t0 + day, reason: 'feriado' },
      { id: 'b2', resourceId: 'p2', startsAt: t0 + 3 * day, endsAt: t0 + 4 * day, reason: 'folga' },
    ] as unknown as ClinicConfigSnapshot['blocks']
    const a = api()
    render(<ClinicHoursScreen tenantId="t" snap={s} api={a} generation={1} onSaved={async () => undefined} />)
    expect(screen.getByText(/Clínica inteira · Feriado/)).toBeTruthy()
    expect(screen.getByText(/Bia · Folga/)).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: /^Opções de Bia/ })[0]!)
    expect(await screen.findByText(/Remover Bia · Folga\?/)).toBeTruthy()
    expect(a.deleteBlock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Remover' }))
    await waitFor(() => expect(a.deleteBlock).toHaveBeenCalledWith('t', 'b2', expect.anything()))
  })

  it('fechar a clínica mostra o impacto antes de salvar e cria o bloqueio no escopo da clínica', async () => {
    const a = api()
    ;(a.createBlock as ReturnType<typeof vi.fn>).mockImplementation(async (_t: string, body: { dryRun?: boolean }) =>
      body.dryRun
        ? { created: false, block: null, affectedAppointments: [{ id: 'a1', contactLabel: 'Carla', startsAt: Date.UTC(2026, 10, 15, 13), endsAt: Date.UTC(2026, 10, 15, 14), status: 'confirmed' }] }
        : { created: true, block: {}, affectedAppointments: [] },
    )
    render(<ClinicHoursScreen tenantId="t" snap={snap()} api={a} generation={1} onSaved={async () => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))
    const [from, to] = Array.from(await screen.findAllByLabelText(/^(De|Até)$/)) as HTMLInputElement[]
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

  it('«Quem fica fora» aceita várias pessoas, cria um bloqueio por pessoa e «Clínica inteira» é exclusiva', async () => {
    const a = api()
    render(<ClinicHoursScreen tenantId="t" snap={snap()} api={a} generation={1} onSaved={async () => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))
    fireEvent.click(await screen.findByRole('button', { name: /Quem fica fora/ }))
    fireEvent.click(await screen.findByRole('option', { name: /Ana/ }))
    // «Clínica inteira» vem marcada; escolher uma pessoa a desmarca.
    expect(screen.getByText('1 selecionada')).toBeTruthy()
    fireEvent.click(screen.getByRole('option', { name: /Bia/ }))
    expect(screen.getByText('2 selecionadas')).toBeTruthy()
    // Marcar «Clínica inteira» de novo desmarca as pessoas.
    fireEvent.click(screen.getByRole('option', { name: /Clínica inteira/ }))
    expect(screen.getByText('1 selecionada')).toBeTruthy()
    fireEvent.click(screen.getByRole('option', { name: /Ana/ }))
    fireEvent.click(screen.getByRole('option', { name: /Bia/ }))
    expect(screen.getByText('2 selecionadas')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }))
    const [from, to] = Array.from(await screen.findAllByLabelText(/^(De|Até)$/)) as HTMLInputElement[]
    fireEvent.change(from!, { target: { value: '2026-11-10' } })
    fireEvent.change(to!, { target: { value: '2026-11-20' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Salvar para 2 pessoas' }))
    await waitFor(() => {
      const real = (a.createBlock as ReturnType<typeof vi.fn>).mock.calls.filter((c) => !c[1].dryRun)
      expect(real.map((c) => c[1].resourceId)).toEqual(['p1', 'p2'])
    })
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

describe('Ficha da profissional — rascunho do horário próprio (#257)', () => {
  /** Estado logo depois de trocar para «Horário próprio»: modo `own`, ainda sem janelas salvas. */
  function ownWithoutWindows(): ClinicConfigSnapshot {
    const s = snap()
    return {
      ...s,
      resources: s.resources.map((r) => (r.id === 'p1' ? { ...r, hoursMode: 'own' } : r)),
    } as unknown as ClinicConfigSnapshot
  }

  /** Mesmo estado depois de gravar a cópia do horário da clínica para a profissional. */
  function ownWithCopy(): ClinicConfigSnapshot {
    const s = ownWithoutWindows()
    return {
      ...s,
      weeklyWindows: [...s.weeklyWindows, ...[1, 2, 3, 4, 5].map((d) => win('p1', d, 480, 1080))],
    } as unknown as ClinicConfigSnapshot
  }

  const extras = (s: ClinicConfigSnapshot) => (
    <ProfessionalExtras
      resource={s.resources.find((r) => r.id === 'p1')!}
      tenantId="t"
      snap={s}
      api={api()}
      generation={1}
      onSaved={async () => undefined}
    />
  )

  it('depois de gravar a cópia da clínica, o editor mostra os dias abertos e não há nada a salvar', () => {
    const view = render(extras(ownWithoutWindows()))
    fireEvent.click(screen.getByRole('tab', { name: 'Horário' }))
    expect(screen.getAllByText('Fechado')).toHaveLength(7)
    view.rerender(extras(ownWithCopy()))
    expect(screen.getAllByText('Fechado')).toHaveLength(2)
    expect(screen.getAllByText('08:00 – 18:00')).toHaveLength(5)
    expect((screen.getByRole('button', { name: 'Horário salvo' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('edição em andamento não é descartada quando o horário salvo é atualizado', () => {
    const view = render(extras(ownWithoutWindows()))
    fireEvent.click(screen.getByRole('tab', { name: 'Horário' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Sábado: fechado' }))
    expect(screen.getByRole('switch', { name: 'Sábado: aberto' })).toBeTruthy()
    view.rerender(extras(ownWithCopy()))
    expect(screen.getByRole('switch', { name: 'Sábado: aberto' })).toBeTruthy()
  })
})
