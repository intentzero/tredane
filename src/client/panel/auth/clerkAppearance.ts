/**
 * Aparência Clerk partilhada (SignIn + UserProfile modal).
 * Cores/fonte alinhadas aos tokens do painel (DEC-041 / DEC-050 / DEC-073).
 */
export const clerkAppearance = {
  variables: {
    colorPrimary: '#0E5A5C',
    colorText: '#142625',
    colorTextSecondary: '#424B4A',
    colorBackground: '#FFFFFF',
    colorInputBackground: '#FFFFFF',
    colorInputText: '#142625',
    borderRadius: '12px',
    fontFamily: 'Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif',
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
