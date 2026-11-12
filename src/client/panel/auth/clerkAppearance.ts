/**
 * Aparência Clerk partilhada (SignIn / SignUp / UserProfile).
 * Cores/fonte alinhadas aos tokens do painel (DEC-041 / DEC-050 / DEC-073).
 *
 * «Cadastro transparente» (paridade Legal Layer / DEC-021):
 * - `elevation: 'flush'` remove cartão elevado (borda, sombra, padding exterior)
 * - `logoPlacement: 'none'` — a marca Tredane fica fora do Clerk (`BrandHorizontal`)
 * - fundo transparente para o formulário assentar na atmosfera do painel
 *
 * OTP: Clerk aplica opacidade baixa a `colorBorder`. Com `--color-line-border`
 * (#E1E3E0) as 6 casas do código ficam quase invisíveis no cartão branco —
 * só a célula focada mostra um traço fraco. `otpCodeFieldInput` usa a borda
 * de controlo (3:1, DEC-041) e o anel de foco fica no teal primário.
 *
 * Nota: se o Dashboard estiver em Access mode «Invite-only» (`restricted`),
 * o SignUp pode pintar só «Criar sua conta» + Entrar sem e-mail/OTP — o
 * produto não contorna Restricted (convites D1, ADR-0008). `ClerkSignUp`
 * detecta a ausência de inputs e mostra «Cadastro indisponível».
 * Paulo: Access mode → Open. Ver docs/implementation/f1-login-nav.md.
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
