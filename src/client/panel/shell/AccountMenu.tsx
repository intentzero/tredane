import { LogOut, User, UserRound } from 'lucide-react'
import {
  Button,
  Header,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  Popover,
  Separator,
} from 'react-aria-components'

export type AccountMenuProps = {
  name?: string | null
  email?: string | null
  onSignOut: () => void
  /** Abre o perfil Clerk (só em AUTH_MODE=clerk). */
  onOpenProfile?: () => void
  /** Posição do menu (cabeçalho: bottom end; rail desktop: top). */
  placement?: 'bottom end' | 'top' | 'top start' | 'top end'
}

/** Iniciais (até 2) do nome; senão do e-mail; vazio quando não há dados. */
export function accountInitials(name?: string | null, email?: string | null): string {
  const n = (name ?? '').trim()
  if (n) {
    const parts = n.split(/\s+/).filter(Boolean)
    const first = parts[0]?.[0] ?? ''
    const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
    return (first + last).toUpperCase()
  }
  const e = (email ?? '').trim()
  return e ? e[0]!.toUpperCase() : ''
}

/** Avatar no cabeçalho / rail com menu da conta (perfil Clerk opcional + Sair). */
export function AccountMenu({
  name,
  email,
  onSignOut,
  onOpenProfile,
  placement = 'bottom end',
}: AccountMenuProps) {
  const initials = accountInitials(name, email)
  const who = name?.trim() || email?.trim() || 'sua conta'
  return (
    <MenuTrigger>
      <Button className="panel-avatar-btn" aria-label={`Conta: ${who}. Abrir menu.`}>
        <span className="panel-avatar" aria-hidden="true">
          {initials || <User size={20} strokeWidth={2} />}
        </span>
      </Button>
      <Popover className="panel-account-popover" placement={placement} offset={4}>
        <Menu
          className="panel-account-menu"
          aria-label="Menu da conta"
          onAction={(key) => {
            if (key === 'perfil') onOpenProfile?.()
            if (key === 'sair') onSignOut()
          }}
        >
          <MenuSection>
            <Header className="panel-account-id">
              {name?.trim() ? <span className="panel-account-name">{name.trim()}</span> : null}
              {email?.trim() ? <span className="panel-account-email">{email.trim()}</span> : null}
              {!name?.trim() && !email?.trim() ? (
                <span className="panel-account-name">Sessão ativa</span>
              ) : null}
            </Header>
          </MenuSection>
          {onOpenProfile ? (
            <>
              <Separator className="panel-account-sep" />
              <MenuItem
                id="perfil"
                className="panel-account-item"
                textValue="Dados pessoais"
              >
                <UserRound aria-hidden="true" size={18} strokeWidth={2} />
                <span>Dados pessoais</span>
              </MenuItem>
            </>
          ) : null}
          <Separator className="panel-account-sep" />
          <MenuItem id="sair" className="panel-account-item panel-account-item--danger" textValue="Sair">
            <LogOut aria-hidden="true" size={18} strokeWidth={2} />
            <span>Sair</span>
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  )
}
