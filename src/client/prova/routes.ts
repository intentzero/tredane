export type ProvaRoute = 'hub' | 'react-aria-m04' | 'react-aria-m05'

export function resolveProvaRoute(pathname: string): ProvaRoute | null {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/prova') return 'hub'
  if (path === '/prova/react-aria/m04') return 'react-aria-m04'
  if (path === '/prova/react-aria/m05') return 'react-aria-m05'
  // Rotas antigas da candidata Radix (removida em DEC-048) → hub
  if (path === '/prova/radix/m04' || path === '/prova/radix/m05') return 'hub'
  return null
}
