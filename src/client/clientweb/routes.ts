/** Rotas da página web da cliente (DEC-196, ADR-0018). Pública, sem Clerk. */

function normalize(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/'
}

/**
 * `/c` (sessão aberta) e `/c/<token>` (um só segmento) são da página da cliente. O painel da equipe também vive
 * em `/c/:clínica/:área/...` (dois ou mais segmentos): reivindicar o prefixo todo escondia o painel inteiro.
 */
export function isClientWebPath(pathname: string): boolean {
  const path = normalize(pathname)
  return path === '/c' || /^\/c\/[^/]+$/.test(path)
}

/** Token do link em `/c/<token>`; `null` em `/c` (sessão já aberta) ou formato inválido. */
export function clientWebTokenFromPath(pathname: string): string | null {
  const m = /^\/c\/([A-Za-z0-9_-]{1,200})\/?$/.exec(pathname)
  return m ? (m[1] ?? null) : null
}
