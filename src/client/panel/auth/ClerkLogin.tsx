import { SignIn } from '@clerk/react'

const appearance = {
  variables: {
    colorPrimary: '#2F5BD3',
    colorText: '#1C1E21',
    colorTextSecondary: '#474C54',
    colorBackground: '#FFFFFF',
    colorInputBackground: '#FFFFFF',
    colorInputText: '#1C1E21',
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
        <span className="panel-auth-mark" aria-hidden="true">
          T
        </span>
        <span className="panel-auth-name">Tredane</span>
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
