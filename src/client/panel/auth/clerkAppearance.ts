/**
 * Aparência Clerk (SignIn / UserProfile; OTP no SignIn).
 * Cores/fonte alinhadas aos tokens do painel (DEC-041 / DEC-050 / DEC-073).
 *
 * Três perfis (regressão Conta após #686; regressão Continuar/OTP no cartão após #702):
 * - `clerkProviderAppearance` — default do ClerkProvider: variáveis partilhadas e
 *   chrome do modal, **sem** `card`/`rootBox`. O Clerk concatena classes do
 *   Provider com as do componente; se o Provider trouxer `panel-clerk-profile-card`,
 *   o SignIn herda cartão opaco com padding 0 (flush) e o «Continuar» (e-mail e
 *   factor-one / OTP) corta a borda.
 * - `clerkAuthAppearance` — `/entrar` flush + transparente. Só no `<SignIn />`
 *   (inclui passo do código).
 * - `clerkUserProfileAppearance` — modal «Dados pessoais» (Perfil / Segurança)
 *   com cartão opaco e elevação; sem flush. Só em `openUserProfile`.
 *
 * «Cadastro transparente» (paridade Legal Layer / DEC-021):
 * - `/cadastro` usa formulário React Aria + `useSignUp` (sem `<SignUp />` vazio)
 * - `/entrar` mantém `<SignIn />` com `elevation: 'flush'`, `logoPlacement: 'none'`,
 *   fundo transparente e marca Tredane fora do Clerk (`BrandHorizontal`)
 *
 * OTP no SignIn (factor-one): Clerk aplica opacidade baixa a `colorBorder`. Com
 * `--color-line-border` (#D6E6DE) as 6 casas ficam quase invisíveis —
 * `otpCodeFieldInput` usa a borda de controlo (3:1, DEC-041) e o anel teal;
 * `otpCodeFieldInputs` evita overflow horizontal no mobile (flush).
 *
 * Access mode Invite-only: o create via API falha; `ClerkSignUp` mostra erro
 * «Cadastro indisponível» no formulário (não página morta). Paulo: Access → Open.
 * Ver docs/implementation/f1-login-nav.md.
 */

const clerkSharedVariables = {
  colorPrimary: 'var(--color-primary-base)',
  colorPrimaryForeground: 'var(--color-text-on-primary)',
  colorForeground: 'var(--color-text-primary)',
  colorMutedForeground: 'var(--color-text-secondary)',
  colorInput: 'var(--color-surface-card)',
  colorInputForeground: 'var(--color-text-primary)',
  colorNeutral: 'var(--color-text-primary)',
  colorBorder: 'var(--color-line-border)',
  colorRing: 'var(--color-primary-base)',
  colorDanger: 'var(--color-danger-ink)',
  borderRadius: 'var(--radius-lg)',
  fontFamily: 'var(--font-family)',
  fontSize: '16px',
} as const

const clerkSharedElements = {
  headerTitle: 'panel-clerk-title',
  headerSubtitle: 'panel-clerk-subtitle',
  formButtonPrimary: 'panel-clerk-primary',
  footerAction: 'panel-clerk-footer',
  logoBox: 'panel-clerk-logo',
  otpCodeFieldInputs: 'panel-clerk-otp-inputs',
  otpCodeFieldInput: 'panel-clerk-otp-input',
} as const

/** `/entrar` — flush, sem chrome de cartão (e-mail + factor-one). Não usar no UserProfile. */
export const clerkAuthAppearance = {
  options: {
    logoPlacement: 'none' as const,
    elevation: 'flush' as const,
    /** Preview sem faixa «Development mode» no cartão (staging ainda é instance Dev). */
    unsafe_disableDevelopmentModeWarnings: true,
  },
  variables: {
    ...clerkSharedVariables,
    colorBackground: 'transparent',
  },
  elements: {
    ...clerkSharedElements,
    rootBox: 'panel-clerk-root',
    card: 'panel-clerk-card',
  },
} as const

/**
 * Default do ClerkProvider: tokens + chrome do modal, sem classes de cartão.
 * SignIn e UserProfile aplicam o respectivo `card`/`rootBox` no sítio certo.
 */
export const clerkProviderAppearance = {
  options: {
    logoPlacement: 'none' as const,
    unsafe_disableDevelopmentModeWarnings: true,
  },
  variables: {
    ...clerkSharedVariables,
    colorBackground: 'var(--color-surface-card)',
  },
  elements: {
    ...clerkSharedElements,
    modalBackdrop: 'panel-clerk-profile-backdrop',
    modalContent: 'panel-clerk-profile-modal',
  },
} as const

/**
 * Modal «Dados pessoais» (`openUserProfile`).
 * Elevação normal e fundo de cartão — evita o UserProfile transparente
 * a colidir com Profissionais / Serviços / Salas na Clínica.
 */
export const clerkUserProfileAppearance = {
  ...clerkProviderAppearance,
  elements: {
    ...clerkProviderAppearance.elements,
    rootBox: 'panel-clerk-profile-root',
    card: 'panel-clerk-profile-card',
  },
} as const

/** Alias histórico: SignIn / testes de cadastro transparente. */
export const clerkAppearance = clerkAuthAppearance
