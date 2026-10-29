import { SignIn } from '@clerk/react'
import { BrandHorizontal } from '../ui/Brand'

const appearance = {
  variables: {
    colorPrimary: '#0E5A5C',
    colorText: '#142625',
    colorTextSecondary: '#424B4A',
    colorBackground: '#FFFFFF',
    colorInputBackground: '#FFFFFF',
    colorInputText: '#142625',
    borderRadius: '12px',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: '16px',
  },
  elements: {
    rootBox: 'panel-clerk-root',
    card: 'panel-clerk-card',
    headerTitle: 'panel-clerk-title',
    headerSubtitle: 'panel-clerk-subtitle',
    formButtonPrimary: 'panel-clerk-primary',
    footerAction: 'panel-clerk-footer',
  },
} as const

/**
 * Componente Clerk real (TEL-08 / M-09).
 * Dashboard: método e-mail + código (sem Organizations, sem MFA no MVP).
 */
export function ClerkLogin() {
  return (
    <div className="panel-auth" lang="pt-BR">
      <div className="panel-auth-brand">
        <BrandHorizontal height={40} />
      </div>
      <div className="panel-auth-clerk">
        <SignIn
          routing="path"
          path="/entrar"
          forceRedirectUrl="/clinicas"
          signUpUrl="/entrar"
          appearance={appearance}
        />
      </div>
      <p className="panel-auth-foot">Sem convite? Peça ao responsável da sua clínica.</p>
    </div>
  )
}
