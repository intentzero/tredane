/** Rotas da página web da cliente (DEC-196, ADR-0018). Pública, sem Clerk. */

function normalize(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/'
}

/** `/c` e tudo debaixo dele pertence à página da cliente. */
export function isClientWebPath(pathname: string): boolean {
  const path = normalize(pathname)
  return path === '/c' || path.startsWith('/c/')
}

/** Token do link em `/c/<token>`; `null` em `/c` (sessão já aberta) ou formato inválido. */
export function clientWebTokenFromPath(pathname: string): string | null {
  const m = /^\/c\/([A-Za-z0-9_-]{1,200})\/?$/.exec(pathname)
  return m ? (m[1] ?? null) : null
}
