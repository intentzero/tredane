export type ProvaRoute =
  | 'hub'
  | 'radix-m04'
  | 'radix-m05'
  | 'react-aria-m04'
  | 'react-aria-m05'

export function resolveProvaRoute(pathname: string): ProvaRoute | null {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/prova') return 'hub'
  if (path === '/prova/radix/m04') return 'radix-m04'
  if (path === '/prova/radix/m05') return 'radix-m05'
  if (path === '/prova/react-aria/m04') return 'react-aria-m04'
  if (path === '/prova/react-aria/m05') return 'react-aria-m05'
  return null
}
