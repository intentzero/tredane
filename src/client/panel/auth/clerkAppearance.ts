/**
 * Aparência Clerk partilhada (SignIn / UserProfile; OTP no SignIn).
 * Cores/fonte alinhadas aos tokens do painel (DEC-041 / DEC-050 / DEC-073).
 *
 * «Cadastro transparente» (paridade Legal Layer / DEC-021):
 * - `/cadastro` usa formulário React Aria + `useSignUp` (sem `<SignUp />` vazio)
 * - `/entrar` mantém `<SignIn />` com `elevation: 'flush'`, `logoPlacement: 'none'`,
 *   fundo transparente e marca Tredane fora do Clerk (`BrandHorizontal`)
 *
 * OTP no SignIn: Clerk aplica opacidade baixa a `colorBorder`. Com
 * `--color-line-border` (#E1E3E0) as 6 casas ficam quase invisíveis —
 * `otpCodeFieldInput` usa a borda de controlo (3:1, DEC-041) e o anel teal.
 *
 * Access mode Invite-only: o create via API falha; `ClerkSignUp` mostra erro
 * «Cadastro indisponível» no formulário (não página morta). Paulo: Access → Open.
 * Ver docs/implementation/f1-login-nav.md.
 */
export const clerkAppearance = {
  options: {
    logoPlacement: 'none' as const,
    elevation: 'flush' as const,
    /** Preview sem faixa «Development mode» no cartão (staging ainda é instance Dev). */
    unsafe_disableDevelopmentModeWarnings: true,
  },
  variables: {
    colorPrimary: 'var(--color-primary-base)',
    colorPrimaryForeground: 'var(--color-text-on-primary)',
    colorForeground: 'var(--color-text-primary)',
    colorMutedForeground: 'var(--color-text-secondary)',
    colorBackground: 'transparent',
    colorInput: 'var(--color-surface-card)',
    colorInputForeground: 'var(--color-text-primary)',
    colorNeutral: 'var(--color-text-primary)',
    colorBorder: 'var(--color-line-border)',
    colorRing: 'var(--color-primary-base)',
    colorDanger: 'var(--color-danger-ink)',
    borderRadius: 'var(--radius-lg)',
    fontFamily: 'var(--font-family)',
    fontSize: '16px',
  },
  elements: {
    rootBox: 'panel-clerk-root',
    card: 'panel-clerk-card',
    headerTitle: 'panel-clerk-title',
    headerSubtitle: 'panel-clerk-subtitle',
    formButtonPrimary: 'panel-clerk-primary',
    footerAction: 'panel-clerk-footer',
    logoBox: 'panel-clerk-logo',
    otpCodeFieldInput: 'panel-clerk-otp-input',
  },
} as const
