import { useState } from 'react'
import { Button, Checkbox, Input, Label, TextField } from 'react-aria-components'
import { PanelSelect } from '../../ui/PanelSelect'
import type { ClinicConfigSnapshot, PanelApi } from '../../api'
import { PanelApiError } from '../../api'
import { navigatePanel } from '../../routes'

type ListProps = {
  tenantId: string
  snap: ClinicConfigSnapshot
}

export function ResourcesList({ tenantId, snap }: ListProps) {
  const [tab, setTab] = useState<'professional' | 'room'>('professional')
  const professionals = snap.resources.filter((r) => r.kind === 'professional')
  const rooms = snap.resources.filter(
    (r) => r.kind === 'room' || r.kind === 'equipment',
  )
  const items = tab === 'professional' ? professionals : rooms

  return (
    <div className="clinic-stack">
      <div className="clinic-toolbar">
        <Button
          className="panel-btn panel-btn-ghost"
          onPress={() =>
            navigatePanel({ kind: 'area', area: 'clinica', tenantId, section: 'hub' })
          }
        >
          Voltar
        </Button>
      </div>
      <div className="clinic-tabs" role="group" aria-label="Tipo de recurso">
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
      <ul className="clinic-nav-list">
        {items.map((r) => (
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
                <span>
                  {r.active ? 'Ativo' : 'Inativo'}
                  {r.category ? ` · ${r.category}` : ''}
                  {r.futureAppointmentCount > 0
                    ? ` · ${r.futureAppointmentCount} futuros`
                    : ''}
                </span>
              </span>
            </Button>
          </li>
        ))}
        {items.length === 0 ? (
          <li className="clinic-empty">Nenhum item nesta lista.</li>
        ) : null}
      </ul>
      <Button
        className="panel-btn panel-btn-primary"
        onPress={() =>
          navigatePanel({
            kind: 'area',
            area: 'clinica',
            tenantId,
            section: tab === 'professional' ? 'profissional' : 'sala',
            entityId: 'novo',
          })
        }
      >
        {tab === 'professional' ? 'Adicionar profissional' : 'Adicionar sala'}
      </Button>
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
  const [resourceKind, setResourceKind] = useState<'room' | 'equipment'>(
    existing?.kind === 'equipment' ? 'equipment' : 'room',
  )
  const [active, setActive] = useState(existing?.active ?? true)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setFormError(null)
    setNotice(null)
    try {
      const row = await api.upsertResource(
        tenantId,
        {
          kind: kind === 'professional' ? 'professional' : resourceKind,
          name,
          category: kind === 'professional' ? null : category || null,
          active,
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
      if (row.futureAppointmentCount > 0 && !active) {
        notes.push(
          `${row.futureAppointmentCount} compromisso(s) futuro(s) não foram cancelados — trate-os na agenda.`,
        )
      }
      await onSaved()
      if (notes.length > 0) {
        setNotice(notes.join(' '))
        return
      }
      navigatePanel({ kind: 'area', area: 'clinica', tenantId, section: 'recursos' })
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
          onPress={() =>
            navigatePanel({ kind: 'area', area: 'clinica', tenantId, section: 'recursos' })
          }
        >
          Cancelar
        </Button>
      </div>

      <TextField className="clinic-field">
        <Label>
          {kind === 'professional' ? 'Nome na agenda' : 'Nome da sala ou equipamento'}
        </Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </TextField>

      {kind === 'professional' ? (
        <p className="clinic-footnote">
          A profissional não precisa de acesso ao painel: quem usa o painel é a equipe da clínica.
        </p>
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
          <TextField className="clinic-field">
            <Label>Categoria (opcional)</Label>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Ex.: Sala com laser"
            />
          </TextField>
        </>
      )}

      <Checkbox className="clinic-check clinic-check-card" isSelected={active} onChange={setActive}>
        {kind === 'professional' ? 'Profissional ativa' : 'Recurso ativo'}
      </Checkbox>
      <p className="clinic-footnote">
        Desactivar retira de novos agendamentos e mantém o histórico. Compromissos futuros
        não são cancelados automaticamente.
      </p>

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
          {saving ? 'A salvar…' : 'Salvar'}
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
    </div>
  )
}
