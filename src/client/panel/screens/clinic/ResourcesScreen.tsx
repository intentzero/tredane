import { useMemo, useState } from 'react'
import { Button, Input, Label, TextField } from 'react-aria-components'
import { ChevronRight } from 'lucide-react'
import { Badge } from '../../states/Badge'
import { ClinicCheck } from './ClinicCheck'
import { ClinicListHeader } from './ClinicListHeader'
import { professionalRow, roomRow } from './resourceRows'
import { PanelSelect } from '../../ui/PanelSelect'
import type { ClinicConfigSnapshot, PanelApi, ResourceFutureAppointment } from '../../api'
import { PanelApiError } from '../../api'
import { navigatePanel } from '../../routes'
import { ProfessionalExtras, RoomExtras } from './ResourceExtras'
import {
  DeleteResourceDialog,
  FutureAppointmentsDialog,
  KEEP,
  defaultChoices,
  type FutureChoice,
} from './ResourceLifecycleDialogs'

type ListProps = {
  tenantId: string
  snap: ClinicConfigSnapshot
  /** Aba ativa — vem sempre da rota (/recursos = profissionais, /recursos/salas = salas). */
  tab?: 'professional' | 'room'
}

export function ResourcesList({ tenantId, snap, tab = 'professional' }: ListProps) {
  // Sem estado local para a aba: a rota é a única fonte (separador e conteúdo).
  const setTab = (next: 'professional' | 'room') =>
    navigatePanel({
      kind: 'area',
      area: 'clinica',
      tenantId,
      section: 'recursos',
      ...(next === 'room' ? { entityId: 'salas' } : {}),
    })
  const [showInactive, setShowInactive] = useState(false)
  const professionals = snap.resources.filter((r) => r.kind === 'professional')
  const rooms = snap.resources.filter(
    (r) => r.kind === 'room' || r.kind === 'equipment',
  )
  const all = tab === 'professional' ? professionals : rooms
  const inactiveCount = all.filter((r) => !r.active).length
  const activeCount = all.length - inactiveCount
  const items = showInactive ? all : all.filter((r) => r.active)
  const now = useMemo(() => Date.now(), [snap])

  return (
    <div className="clinic-stack">
      <div className="clinic-toolbar clinic-desktop-hide">
        <Button
          className="panel-btn panel-btn-ghost"
          onPress={() =>
            navigatePanel({ kind: 'area', area: 'clinica', tenantId, section: 'hub' })
          }
        >
          Voltar
        </Button>
      </div>
      <div className="clinic-tabs clinic-desktop-hide" role="group" aria-label="Tipo de recurso">
        <Button
          className={tab === 'professional' ? 'clinic-tab clinic-tab-active' : 'clinic-tab'}
          aria-pressed={tab === 'professional'}
          onPress={() => setTab('professional')}
        >
          Profissionais
        </Button>
        <Button
          className={tab === 'room' ? 'clinic-tab clinic-tab-active' : 'clinic-tab'}
          aria-pressed={tab === 'room'}
          onPress={() => setTab('room')}
        >
          Salas e equipamentos
        </Button>
      </div>
      <ClinicListHeader
        count={
          tab === 'professional'
            ? `${activeCount} ${activeCount === 1 ? 'profissional ativa' : 'profissionais ativas'}`
            : `${activeCount} ${activeCount === 1 ? 'sala ativa' : 'salas ativas'}`
        }
        switchLabel={`Mostrar inativas${inactiveCount > 0 ? ` (${inactiveCount})` : ''}`}
        showInactive={showInactive}
        onShowInactive={setShowInactive}
        addLabel={tab === 'professional' ? 'Adicionar profissional' : 'Adicionar sala'}
        onAdd={() =>
          navigatePanel({
            kind: 'area',
            area: 'clinica',
            tenantId,
            section: tab === 'professional' ? 'profissional' : 'sala',
            entityId: 'novo',
          })
        }
      />
      <ul className="clinic-nav-list">
        {items.map((r) => {
          const pro = r.kind === 'professional' ? professionalRow(snap, r, now) : null
          const room = r.kind !== 'professional' ? roomRow(snap, r) : null
          return (
            <li key={r.id}>
              <Button
                className="clinic-nav-row"
                onPress={() =>
                  navigatePanel({
                    kind: 'area',
                    area: 'clinica',
                    tenantId,
                    section: r.kind === 'professional' ? 'profissional' : 'sala',
                    entityId: r.id,
                  })
                }
              >
                <span className="clinic-nav-copy">
                  <strong>{r.name}</strong>
                  {pro ? (
                    <>
                      <span>{pro.services}</span>
                      <span>{pro.homeRoom ? `Sala: ${pro.homeRoom}` : 'Sem sala'}</span>
                      {pro.today ? <span>{pro.today}</span> : null}
                    </>
                  ) : null}
                  {room ? (
                    <>
                      <span>{room.capacity}</span>
                      <span>{room.usage}</span>
                    </>
                  ) : null}
                  {r.futureAppointmentCount > 0 ? (
                    <span>
                      {r.futureAppointmentCount}{' '}
                      {r.futureAppointmentCount === 1 ? 'horário marcado' : 'horários marcados'}
                    </span>
                  ) : null}
                </span>
                {!r.active ? <Badge tone="closed">Inativa</Badge> : null}
                {r.active && pro?.missingHomeRoom ? <Badge tone="wait">Falta sala</Badge> : null}
                {r.active && pro?.missingHours ? <Badge tone="wait">Falta horário</Badge> : null}
                <ChevronRight aria-hidden size={18} />
              </Button>
            </li>
          )
        })}
        {items.length === 0 ? (
          <li className="clinic-empty">
            {inactiveCount > 0 && !showInactive
              ? `${tab === 'professional' ? 'Nenhuma profissional ativa' : 'Nenhuma sala ativa'}. Ligue «Mostrar inativas» para ver o histórico.`
              : tab === 'professional'
                ? 'Nenhuma profissional cadastrada ainda.'
                : 'Nenhuma sala cadastrada ainda.'}
          </li>
        ) : null}
      </ul>
    </div>
  )
}

type FormProps = {
  tenantId: string
  kind: 'professional' | 'room'
  entityId: string
  snap: ClinicConfigSnapshot
  api: PanelApi
  generation: number
  onSaved: () => Promise<void>
}

export function ResourceForm({
  tenantId,
  kind,
  entityId,
  snap,
  api,
  generation,
  onSaved,
}: FormProps) {
  const existing =
    entityId === 'novo' ? null : snap.resources.find((r) => r.id === entityId)
  const [name, setName] = useState(existing?.name ?? '')
  const [category, setCategory] = useState(existing?.category ?? '')
  const [capacity, setCapacity] = useState(String(existing?.capacity ?? 1))
  const [sharedNotice, setSharedNotice] = useState(existing?.sharedSpaceNotice ?? '')
  const [homeRoomId, setHomeRoomId] = useState<string | null>(existing?.homeRoomId ?? null)
  const [attendanceMode, setAttendanceMode] = useState<'cada_profissional' | 'uma_para_todas'>(
    existing?.attendanceMode === 'uma_para_todas' ? 'uma_para_todas' : 'cada_profissional',
  )
  const [sameSexInSlot, setSameSexInSlot] = useState(Boolean(existing?.sameSexInSlot))
  const [resourceKind, setResourceKind] = useState<'room' | 'equipment'>(
    existing?.kind === 'equipment' ? 'equipment' : 'room',
  )
  const roomOptions = snap.resources
    .filter((r) => r.kind === 'room' && r.active)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .map((r) => ({ id: r.id, label: r.name }))
  const active = existing?.active ?? true
  const [saving, setSaving] = useState(false)
  const [lifecycleBusy, setLifecycleBusy] = useState(false)
  const [futureApts, setFutureApts] = useState<ResourceFutureAppointment[] | null>(null)
  const [choices, setChoices] = useState<FutureChoice>({})
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const timeZone = snap.settings?.timezone ?? 'America/Sao_Paulo'
  const label = kind === 'professional' ? 'profissional' : 'sala ou equipamento'

  // A lista de salas é a aba «salas» da rota; sem o entityId, voltaria para Profissionais.
  function backToList() {
    navigatePanel({
      kind: 'area',
      area: 'clinica',
      tenantId,
      section: 'recursos',
      ...(kind === 'professional' ? {} : { entityId: 'salas' }),
    })
  }

  function errorText(err: unknown, fallback: string): string | null {
    if (err instanceof PanelApiError) {
      if (err.message === 'stale_tenant_response') return null
      const code = err.code as string
      if (code === 'resource_has_history') {
        return 'Não é possível excluir: este item já teve compromissos. Desative-o para manter o histórico.'
      }
      if (code === 'resource_required_by_service') {
        return 'Não é possível excluir: um serviço exige esta sala ou equipamento. Altere o serviço antes.'
      }
      if (code === 'reassign_conflict' || code === 'appointment_not_on_resource'
        || code === 'appointment_version_conflict') {
        return 'A agenda mudou e um destino deixou de estar livre. Nada foi alterado — revise as escolhas.'
      }
    }
    return fallback
  }

  async function reactivate() {
    if (!existing) return
    setLifecycleBusy(true)
    setFormError(null)
    setNotice(null)
    try {
      await api.setResourceActive(tenantId, existing.id, true, {
        generation,
        expectGeneration: () => generation,
      })
      await onSaved()
      setNotice(`${existing.name} voltou a aceitar novos agendamentos.`)
    } catch (err) {
      const msg = errorText(err, 'Não foi possível reativar. Tente de novo.')
      if (msg) setFormError(msg)
    } finally {
      setLifecycleBusy(false)
    }
  }

  async function submitDeactivate(selected: FutureChoice, apts: ResourceFutureAppointment[]) {
    if (!existing) return
    setLifecycleBusy(true)
    setDialogError(null)
    setFormError(null)
    setNotice(null)
    try {
      const reassignments = apts
        .filter((a) => selected[a.appointmentId] && selected[a.appointmentId] !== KEEP)
        .map((a) => ({
          appointmentId: a.appointmentId,
          targetResourceId: selected[a.appointmentId] as string,
          expectedVersion: a.version,
        }))
      const row = await api.deactivateResource(tenantId, existing.id, reassignments, {
        generation,
        expectGeneration: () => generation,
      })
      setFutureApts(null)
      await onSaved()
      const parts = [`${existing.name} foi desativado para novos agendamentos. O histórico foi mantido.`]
      if (row.reassigned.length > 0) parts.push(`${row.reassigned.length} compromisso(s) remanejado(s).`)
      if (row.keptAppointmentIds.length > 0) {
        parts.push(`${row.keptAppointmentIds.length} compromisso(s) mantido(s) — trate-os na agenda se precisar.`)
      }
      if (row.servicesWithoutResource && row.servicesWithoutResource.length > 0) {
        parts.push('Alguns serviços ficaram sem recurso ativo nesta categoria e deixam de oferecer novos horários.')
      }
      setNotice(parts.join(' '))
    } catch (err) {
      const msg = errorText(err, 'Não foi possível desativar. Nada foi alterado.')
      if (msg) {
        if (apts.length > 0) setDialogError(msg)
        else setFormError(msg)
      }
    } finally {
      setLifecycleBusy(false)
    }
  }

  async function startDeactivate() {
    if (!existing) return
    setFormError(null)
    setNotice(null)
    if (existing.futureAppointmentCount === 0) {
      await submitDeactivate({}, [])
      return
    }
    setLifecycleBusy(true)
    try {
      const out = await api.listResourceFutureAppointments(tenantId, existing.id, {
        generation,
        expectGeneration: () => generation,
      })
      if (out.appointments.length === 0) {
        setLifecycleBusy(false)
        await submitDeactivate({}, [])
        return
      }
      setChoices(defaultChoices(out.appointments))
      setDialogError(null)
      setFutureApts(out.appointments)
    } catch (err) {
      const msg = errorText(err, 'Não foi possível carregar os compromissos futuros.')
      if (msg) setFormError(msg)
    } finally {
      setLifecycleBusy(false)
    }
  }

  async function confirmDelete() {
    if (!existing) return
    setLifecycleBusy(true)
    setDialogError(null)
    try {
      await api.deleteResource(tenantId, existing.id, {
        generation,
        expectGeneration: () => generation,
      })
      setDeleteOpen(false)
      await onSaved()
      backToList()
    } catch (err) {
      const msg = errorText(err, 'Não foi possível excluir. Tente de novo.')
      if (msg) setDialogError(msg)
    } finally {
      setLifecycleBusy(false)
    }
  }

  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // «Categoria» só aparece em salas que já a usam; no lugar dela, a sala lista os serviços feitos ali.
  const showCategory =
    category.trim() !== '' || snap.services.some((s) => s.roomRequirement.mode === 'category')
  const capacityNumber = Number(capacity)
  const capacityValid = Number.isInteger(capacityNumber) && capacityNumber >= 1 && capacityNumber <= 50

  async function save() {
    setFormError(null)
    setNotice(null)
    if (kind !== 'professional' && resourceKind === 'room' && !capacityValid) {
      setFormError('A sala atende de 1 a 50 pessoas ao mesmo tempo.')
      return
    }
    setSaving(true)
    try {
      const row = await api.upsertResource(
        tenantId,
        {
          kind: kind === 'professional' ? 'professional' : resourceKind,
          name,
          category: kind === 'professional' ? null : category || null,
          active,
          ...(kind === 'professional' ? { homeRoomId } : {}),
          ...(kind !== 'professional' && resourceKind === 'room'
            ? {
                capacity: capacityNumber,
                sharedSpaceNotice: sharedNotice.trim() || null,
                attendanceMode: capacityNumber > 1 ? attendanceMode : 'cada_profissional',
                sameSexInSlot: capacityNumber > 1 ? sameSexInSlot : false,
              }
            : {}),
        },
        {
          resourceId: existing?.id,
          generation,
          expectGeneration: () => generation,
        },
      )
      const notes: string[] = []
      if (row.servicesWithoutResource && row.servicesWithoutResource.length > 0) {
        notes.push(
          'Alguns serviços ficaram sem recurso ativo nesta categoria e deixam de oferecer novos horários. Compromissos futuros permanecem.',
        )
      }
      if (row.overCapacity && row.overCapacity.length > 0) {
        const fmt = new Intl.DateTimeFormat('pt-BR', {
          timeZone,
          weekday: 'short',
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
        const list = row.overCapacity
          .slice(0, 10)
          .map((o) => `${fmt.format(o.startsAt)} (${o.count} pessoas)`)
          .join('; ')
        const more = row.overCapacity.length > 10 ? ` e mais ${row.overCapacity.length - 10}` : ''
        notes.push(
          `Capacidade salva. Estes horários já têm mais pessoas marcadas do que a nova capacidade, e nada foi desmarcado: ${list}${more}.`,
        )
      }
      await onSaved()
      if (notes.length > 0) {
        setNotice(notes.join(' '))
        return
      }
      if (!existing) {
        // Nova ficha: segue para ela, onde ficam serviços, horário e folgas.
        navigatePanel({
          kind: 'area',
          area: 'clinica',
          tenantId,
          section: kind === 'professional' ? 'profissional' : 'sala',
          entityId: row.id,
        })
        return
      }
      backToList()
    } catch (err) {
      if (err instanceof PanelApiError && err.message === 'stale_tenant_response') return
      setFormError(
        'Não foi possível salvar. Os dados do formulário foram mantidos.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="clinic-stack clinic-form">
      <div className="clinic-toolbar">
        <Button
          className="panel-btn panel-btn-ghost"
          onPress={backToList}
        >
          Cancelar
        </Button>
      </div>

      <TextField className="clinic-field">
        <Label>
          {kind === 'professional' ? 'Nome na agenda' : 'Nome da sala ou equipamento'}
        </Label>
        <Input autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      </TextField>

      {kind === 'professional' ? (
        <>
          <PanelSelect
            className="clinic-field"
            label="Sala"
            placeholder={roomOptions.length === 0 ? 'Cadastre uma sala primeiro' : 'Escolha a sala'}
            value={homeRoomId}
            onChange={(id) => setHomeRoomId(id)}
            options={roomOptions}
            isDisabled={roomOptions.length === 0}
          />
          <p className="clinic-footnote">
            Marcações novas caem nesta sala. Várias profissionais podem partilhar a mesma. A equipa
            pode trocar a sala só numa marcação; as seguintes voltam a esta. A profissional não
            precisa de acesso ao painel: quem usa o painel é a equipe da clínica.
          </p>
        </>
      ) : (
        <>
          <PanelSelect
            className="clinic-field"
            label="Tipo"
            value={resourceKind}
            onChange={(v) => setResourceKind(v)}
            isDisabled={Boolean(existing)}
            options={[
              { id: 'room' as const, label: 'Sala' },
              { id: 'equipment' as const, label: 'Equipamento' },
            ]}
          />
          {showCategory ? (
          <TextField className="clinic-field">
            <Label>Categoria (opcional)</Label>
            <Input
              autoComplete="off"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Ex.: Sala com laser"
            />
          </TextField>
          ) : null}
          {resourceKind === 'room' ? (
            <>
              <TextField className="clinic-field">
                <Label>Atende ao mesmo tempo (pessoas)</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={50}
                  step={1}
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                />
              </TextField>
              <p className="clinic-footnote">
                De 1 a 50. Com 1, a sala atende uma pessoa de cada vez — sem perguntas de modo nem de
                sexo.
              </p>
              {capacityValid && capacityNumber > 1 ? (
                <>
                  <PanelSelect
                    className="clinic-field"
                    label="Modo de atendimento"
                    value={attendanceMode}
                    onChange={(id) =>
                      setAttendanceMode(
                        id === 'uma_para_todas' ? 'uma_para_todas' : 'cada_profissional',
                      )
                    }
                    options={[
                      {
                        id: 'cada_profissional' as const,
                        label: 'Cada profissional com a sua cliente',
                      },
                      {
                        id: 'uma_para_todas' as const,
                        label: 'Uma profissional para todas',
                      },
                    ]}
                  />
                  <p className="clinic-footnote">
                    {attendanceMode === 'uma_para_todas'
                      ? 'A mesma profissional pode atender várias clientes nesta sala, até à capacidade. Não fica noutra sala no mesmo horário.'
                      : 'Cada profissional trava só a si. A sala recusa quando chega à capacidade.'}
                  </p>
                  <ClinicCheck
                    isSelected={sameSexInSlot}
                    onChange={setSameSexInSlot}
                  >
                    Mesmo sexo neste horário
                  </ClinicCheck>
                  <p className="clinic-footnote">
                    Ligado, o bloco fica com o sexo da primeira marcação feminina ou masculina.
                    «Permitir os dois» naquele horário é só da responsável, na agenda.
                  </p>
                </>
              ) : null}
              <TextField className="clinic-field">
                <Label>Frase para a confirmação pelo WhatsApp (opcional)</Label>
                <Input
                  autoComplete="off"
                  maxLength={300}
                  value={sharedNotice}
                  onChange={(e) => setSharedNotice(e.target.value)}
                  placeholder="Ex.: O espaço de bronzeamento é compartilhado."
                />
              </TextField>
              <p className="clinic-footnote">
                Entra na mensagem de confirmação dos horários nesta sala. Não diga quantas vagas restam.
              </p>
            </>
          ) : null}
        </>
      )}

      {existing && kind === 'professional' ? (
        <ProfessionalExtras
          resource={existing}
          tenantId={tenantId}
          snap={snap}
          api={api}
          generation={generation}
          onSaved={onSaved}
        />
      ) : null}
      {existing && kind !== 'professional' ? (
        <RoomExtras
          resource={existing}
          tenantId={tenantId}
          snap={snap}
          api={api}
          generation={generation}
          onSaved={onSaved}
        />
      ) : null}

      {existing ? (
        <section className="clinic-stack" aria-label="Situação">
          <p className="clinic-nav-copy">
            <strong>{active ? 'Ativo' : 'Inativo'}</strong>
            <span>
              {active
                ? existing.futureAppointmentCount > 0
                  ? `Recebe novos agendamentos · ${existing.futureAppointmentCount} futuro(s)`
                  : 'Recebe novos agendamentos'
                : 'Não recebe novos agendamentos. O histórico continua disponível.'}
            </span>
          </p>
          {active ? (
            <Button
              className="panel-btn panel-btn-ghost"
              isDisabled={lifecycleBusy || saving}
              onPress={() => void startDeactivate()}
            >
              {lifecycleBusy ? 'Aguarde…' : 'Desativar'}
            </Button>
          ) : (
            <Button
              className="panel-btn panel-btn-primary"
              isDisabled={lifecycleBusy || saving}
              onPress={() => void reactivate()}
            >
              {lifecycleBusy ? 'Aguarde…' : 'Reativar'}
            </Button>
          )}
          <p className="clinic-footnote">
            Desativar retira de novos agendamentos e mantém o histórico. Compromissos futuros
            nunca são cancelados automaticamente: você escolhe remanejar ou manter cada um.
          </p>
          {existing.hasAppointmentHistory === false ? (
            <Button
              className="panel-btn-danger"
              isDisabled={lifecycleBusy || saving}
              onPress={() => {
                setDialogError(null)
                setDeleteOpen(true)
              }}
            >
              {`Excluir ${label}`}
            </Button>
          ) : (
            <p className="clinic-footnote">
              Já teve compromissos, por isso não pode ser excluído — só desativado.
            </p>
          )}
        </section>
      ) : null}

      {notice ? (
        <p className="clinic-banner clinic-banner-inline" role="status">
          {notice}
        </p>
      ) : null}
      {formError ? (
        <p className="clinic-form-error" role="alert">
          {formError}
        </p>
      ) : null}

      <div className="clinic-footer-actions">
        <Button
          className="panel-btn panel-btn-primary"
          isDisabled={saving || !name.trim()}
          onPress={() => void save()}
        >
          {saving ? 'Salvando…' : 'Salvar'}
        </Button>
        {notice ? (
          <Button
            className="panel-btn panel-btn-ghost"
            onPress={() =>
              navigatePanel({
                kind: 'area',
                area: 'clinica',
                tenantId,
                section: 'recursos',
              })
            }
          >
            Voltar à lista
          </Button>
        ) : null}
      </div>
      {existing ? (
        <>
          <FutureAppointmentsDialog
            open={futureApts !== null}
            resourceName={existing.name}
            kind={kind}
            timeZone={timeZone}
            appointments={futureApts ?? []}
            choices={choices}
            busy={lifecycleBusy}
            error={dialogError}
            onChange={setChoices}
            onClose={() => setFutureApts(null)}
            onConfirm={() => void submitDeactivate(choices, futureApts ?? [])}
          />
          <DeleteResourceDialog
            open={deleteOpen}
            resourceName={existing.name}
            busy={lifecycleBusy}
            error={dialogError}
            onClose={() => setDeleteOpen(false)}
            onConfirm={() => void confirmDelete()}
          />
        </>
      ) : null}
    </div>
  )
}
