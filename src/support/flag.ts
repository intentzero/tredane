/**
 * ADR-0017 §7: a sessão de suporte (ativar, trocar o handoff e o overlay nas rotas da clínica) fica desligada em
 * produção até a revisão de segurança. Fora de produção (staging, desenvolvimento, testes) está sempre ligada.
 */
export function supportSessionsEnabled(
  env: { ENVIRONMENT?: string; SUPPORT_SESSIONS_ENABLED?: string } | undefined,
): boolean {
  if (env?.ENVIRONMENT !== 'production') return true
  return env?.SUPPORT_SESSIONS_ENABLED === 'true'
}
