import { SignIn } from '@clerk/react'
import { BrandHorizontal } from '../ui/Brand'
import { clerkAppearance } from './clerkAppearance'

/**
 * Componente Clerk real (TEL-08 / M-09).
 * Dashboard: método e-mail + código (sem Organizations, sem MFA no MVP).
 * Layout Confirmado Paulo 31/10/2026: bloco centrado + fundo surface.app.
 */
export function ClerkLogin() {
  return (
    <div className="panel-auth" lang="pt-BR">
      <div className="panel-auth-atmosphere" aria-hidden="true" />
      <div className="panel-auth-stack">
        <div className="panel-auth-brand">
          <BrandHorizontal height={48} />
        </div>
        <div className="panel-auth-clerk">
          <SignIn
            routing="path"
            path="/entrar"
            forceRedirectUrl="/clinicas"
            signUpUrl="/entrar"
            appearance={clerkAppearance}
          />
        </div>
        <p className="panel-auth-foot">Sem convite? Peça ao responsável da sua clínica.</p>
      </div>
    </div>
  )
}
