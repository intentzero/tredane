/**
 * Aparência Clerk partilhada (SignIn + UserProfile modal).
 * Cores/fonte alinhadas aos tokens do painel (DEC-041 / DEC-050 / DEC-073).
 */
export const clerkAppearance = {
  variables: {
    colorPrimary: 'var(--color-primary-base)',
    colorPrimaryForeground: 'var(--color-text-on-primary)',
    colorForeground: 'var(--color-text-primary)',
    colorMutedForeground: 'var(--color-text-secondary)',
    colorBackground: 'var(--color-surface-card)',
    colorInput: 'var(--color-surface-card)',
    colorInputForeground: 'var(--color-text-primary)',
    colorNeutral: 'var(--color-text-primary)',
    colorBorder: 'var(--color-line-border)',
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
  },
} as const
