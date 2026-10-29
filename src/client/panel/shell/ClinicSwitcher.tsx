import { Check, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import {
  Button,
  Dialog,
  Heading,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  Modal,
  ModalOverlay,
  Popover,
  Separator,
} from 'react-aria-components'
import type { TenantSummary } from '../api'
import { markPickingClinic } from '../auth/session'
import type { PanelArea } from '../routes'
import { areaRoute, navigatePanel } from '../routes'
import { useTenant } from '../tenant/TenantContext'
import { useMediaQuery } from '../ui/useMediaQuery'

const SEE_ALL = '__todas__'

function roleLabel(role: TenantSummary['role']): string {
  return role === 'owner' ? 'Responsável' : 'Atendente'
}

function clinicInitials(name: string): string {
  const parts = name.replace(/\([^)]*\)/g, '').trim().split(/\s+/).filter(Boolean)
  const significant = parts.filter((p) => p.length > 2)
  const pick = (significant.length >= 2 ? significant : parts).slice(0, 2)
  return pick.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

type Props = {
  /** Clínica ativa. */
  tenantId: string
  name: string
  /** Área aberta: a troca recarrega esta mesma área na clínica nova. */
  area: PanelArea
  tenants: TenantSummary[]
}

/**
 * Troca de clínica sem sair da tela (DEC-017: troca explícita; o `selectTenant` revalida o
 * membership e limpa cache e conexões da clínica anterior). Com uma só clínica não há escolha:
 * o nome é texto. Desktop: menu; celular: folha de baixo.
 */
export function ClinicSwitcher({ tenantId, name, area, tenants }: Props) {
  const { selectTenant, reloadTenants } = useTenant()
  const phone = useMediaQuery('(max-width: 767.98px)')
  const [sheetOpen, setSheetOpen] = useState(false)

  if (tenants.length < 2) {
    return <span className="panel-subtitle">{name}</span>
  }

  const seeAll = () => {
    markPickingClinic()
    navigatePanel({ kind: 'clinicas' })
  }

  const choose = (target: TenantSummary) => {
    if (target.tenantId === tenantId) return
    void selectTenant(target.tenantId, target.name).then((ok) => {
      if (ok) {
        // A área «clinica» é só do responsável: na outra clínica pode não ser.
        const next: PanelArea = area === 'clinica' && target.role !== 'owner' ? 'conversas' : area
        navigatePanel(areaRoute(target.tenantId, next), true)
      } else {
        // Acesso retirado ou erro: a tela de estado já avisa; atualiza a lista de clínicas.
        reloadTenants()
      }
    })
  }

  const label = `Clínica ativa: ${name}. Trocar de clínica.`

  const items = tenants.map((t) => {
    const current = t.tenantId === tenantId
    return { t, current }
  })

  if (phone) {
    return (
      <>
        <Button
          className="panel-clinic-switch"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          onPress={() => setSheetOpen(true)}
        >
          <span className="panel-clinic-switch-name">{name}</span>
          <ChevronDown aria-hidden="true" size={16} strokeWidth={2} />
        </Button>
        <ModalOverlay
          isOpen={sheetOpen}
          onOpenChange={setSheetOpen}
          className="panel-overlay"
          style={{ position: 'fixed', inset: 0, zIndex: 30 }}
          isDismissable
        >
          <Modal>
            <Dialog
              className="panel-sheet"
              style={{ position: 'fixed', left: 0, right: 0, bottom: 0 }}
              aria-labelledby="clinic-sheet-title"
            >
              <span className="panel-sheet-handle" aria-hidden="true" />
              <Heading slot="title" id="clinic-sheet-title" className="thread-actions-title">
                Trocar de clínica
              </Heading>
              <div role="radiogroup" aria-label="As suas clínicas" className="clinic-sheet-list">
                {items.map(({ t, current }) => (
                  <button
                    key={t.tenantId}
                    className={`clinic-sheet-item${current ? ' clinic-sheet-item--current' : ''}`}
                    type="button"
                    role="radio"
                    aria-checked={current}
                    onClick={() => {
                      setSheetOpen(false)
                      choose(t)
                    }}
                  >
                    <span className="panel-clinic-avatar" aria-hidden="true">
                      {clinicInitials(t.name)}
                    </span>
                    <span className="panel-clinic-copy">
                      <span className="panel-clinic-name">{t.name}</span>
                      <span className="panel-clinic-meta">
                        {roleLabel(t.role)}
                        {current ? ' · atual' : ''}
                      </span>
                    </span>
                    {current ? <Check aria-hidden="true" size={20} strokeWidth={2.5} /> : null}
                  </button>
                ))}
              </div>
              <Button
                className="panel-btn-ghost clinic-sheet-all"
                onPress={() => {
                  setSheetOpen(false)
                  seeAll()
                }}
              >
                Ver todas as clínicas
              </Button>
            </Dialog>
          </Modal>
        </ModalOverlay>
      </>
    )
  }

  return (
    <MenuTrigger>
      <Button className="panel-clinic-switch" aria-label={label}>
        <span className="panel-clinic-switch-name">{name}</span>
        <ChevronDown aria-hidden="true" size={16} strokeWidth={2} />
      </Button>
      <Popover className="panel-popover clinic-menu-popover" placement="bottom start">
        <Menu
          className="panel-menu clinic-menu"
          aria-label="Trocar de clínica"
          selectionMode="single"
          selectedKeys={[tenantId]}
          onAction={(key) => {
            if (key === SEE_ALL) {
              seeAll()
              return
            }
            const target = tenants.find((t) => t.tenantId === String(key))
            if (target) choose(target)
          }}
        >
          {items.map(({ t, current }) => (
            <MenuItem
              key={t.tenantId}
              id={t.tenantId}
              textValue={t.name}
              className="panel-menu-item clinic-menu-item"
            >
              <span className="panel-clinic-avatar" aria-hidden="true">
                {clinicInitials(t.name)}
              </span>
              <span className="panel-clinic-copy">
                <span className="panel-clinic-name">{t.name}</span>
                <span className="panel-clinic-meta">{roleLabel(t.role)}</span>
              </span>
              {current ? <Check aria-hidden="true" size={18} strokeWidth={2.5} /> : null}
            </MenuItem>
          ))}
          <Separator className="panel-menu-separator" />
          <MenuSection selectionMode="none">
            <MenuItem id={SEE_ALL} textValue="Ver todas as clínicas" className="panel-menu-item">
              Ver todas as clínicas
            </MenuItem>
          </MenuSection>
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}
