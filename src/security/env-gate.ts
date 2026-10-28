/**
 * Gate de ambiente para superfícies de harness/teste (revisão de segurança C2/A3/B3).
 * Fora de development/test, estas rotas não existem (404) — independentemente de AUTH_MODE.
 */
export type EnvLike = { ENVIRONMENT?: string } | undefined

/** development (default quando ausente) ou test. Staging/production — e qualquer valor desconhecido — não. */
export function isDevelopmentEnv(env: EnvLike): boolean {
  const e = env?.ENVIRONMENT
  return e === undefined || e === '' || e === 'development' || e === 'dev' || e === 'test' || e === 'local'
}

/** staging ou production: exigem segredos reais e modos live (fail closed). */
export function isDeployedEnv(env: EnvLike): boolean {
  return !isDevelopmentEnv(env)
}

const HARNESS_PATTERNS: RegExp[] = [
  /^\/api\/f0(\/|$)/,
  /^\/api\/f1(\/|$)/,
  /^\/api\/f5(\/|$)/,
  /^\/api\/f6(\/|$)/,
  /^\/api\/webhooks\/whatsapp\/dev(\/|$)/,
  /^\/api\/tenants\/[^/]+\/pix\/dev(\/|$)/,
  /^\/api\/tenants\/[^/]+\/inbox\/seed-demo\/?$/,
  /^\/api\/tenants\/[^/]+\/pipeline\/seed-demo\/?$/,
  /^\/api\/tenants\/[^/]+\/config\/test-appointments\/?$/,
]

export function isHarnessPath(pathname: string): boolean {
  return HARNESS_PATTERNS.some((re) => re.test(pathname))
}

/**
 * Estritamente staging. Ausente, vazio, development, production ou desconhecido → false
 * (fail closed). Usado por ações destrutivas só de staging (ex.: reset operacional).
 */
export function isStagingEnv(env: EnvLike): boolean {
  return env?.ENVIRONMENT === 'staging'
}
