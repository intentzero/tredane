import {
  createClerkAuthorityReader,
  createClerkClientFromConfig,
  createClerkSessionAuthenticator,
  type ClerkAuthConfig,
} from './clerk-backend'
import type { AuthServices } from './authorize'
import { adminDbFromEnv } from './middleware'
import {
  createSyntheticAuthorityReader,
  createSyntheticSessionAuthenticator,
} from './synthetic'
import {
  createClerkVerifiedEmailReader,
  createSyntheticVerifiedEmailReader,
} from './verified-email'

export type WorkerAuthEnv = {
  DB?: D1Database
  CLERK_SECRET_KEY?: string
  CLERK_PUBLISHABLE_KEY?: string
  CLERK_JWT_KEY?: string
  CLERK_AUTHORIZED_PARTIES?: string
  AUTH_MODE?: string
  ENVIRONMENT?: string
}

function parseAuthorizedParties(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Resolve AUTH_MODE for Worker e bootstrap do cliente (#22). */
export function resolveAuthMode(env: WorkerAuthEnv): 'clerk' | 'synthetic' {
  const explicit = env.AUTH_MODE?.trim().toLowerCase()
  if (explicit === 'synthetic') {
    const environment = env.ENVIRONMENT ?? 'development'
    if (environment === 'staging' || environment === 'production') {
      // Fail closed: never allow synthetic in remote envs even if misconfigured.
      return 'clerk'
    }
    return 'synthetic'
  }
  if (explicit === 'clerk') return 'clerk'
  // Default: synthetic only when Clerk keys are absent in development.
  if (
    (!env.CLERK_SECRET_KEY || !env.CLERK_PUBLISHABLE_KEY) &&
    (env.ENVIRONMENT === 'development' || env.ENVIRONMENT === undefined)
  ) {
    return 'synthetic'
  }
  return 'clerk'
}

export function buildAuthServices(env?: WorkerAuthEnv | null): AuthServices {
  const safeEnv: WorkerAuthEnv = {
    ENVIRONMENT: 'development',
    AUTH_MODE: 'synthetic',
    ...(env ?? {}),
  }
  const mode = resolveAuthMode(safeEnv)
  const db = safeEnv.DB
  if (!db) {
    throw new Error('Binding DB ausente para auth')
  }
  const adminDb = adminDbFromEnv({ DB: db })

  if (mode === 'synthetic') {
    const parties = parseAuthorizedParties(safeEnv.CLERK_AUTHORIZED_PARTIES)
    return {
      sessions: createSyntheticSessionAuthenticator({
        authorizedParties: parties.length > 0 ? parties : ['http://localhost:5173'],
      }),
      authority: createSyntheticAuthorityReader(),
      adminDb,
      verifiedEmails: createSyntheticVerifiedEmailReader(),
    }
  }

  const parties = parseAuthorizedParties(safeEnv.CLERK_AUTHORIZED_PARTIES)
  if (!safeEnv.CLERK_SECRET_KEY || !safeEnv.CLERK_PUBLISHABLE_KEY) {
    throw new Error(
      'Clerk keys ausentes: defina CLERK_SECRET_KEY e CLERK_PUBLISHABLE_KEY (ou AUTH_MODE=synthetic em development)',
    )
  }
  if (
    parties.length === 0 &&
    (safeEnv.ENVIRONMENT === 'staging' || safeEnv.ENVIRONMENT === 'production')
  ) {
    throw new Error('CLERK_AUTHORIZED_PARTIES obrigatório em staging/production')
  }

  const config: ClerkAuthConfig = {
    secretKey: safeEnv.CLERK_SECRET_KEY,
    publishableKey: safeEnv.CLERK_PUBLISHABLE_KEY,
    jwtKey: safeEnv.CLERK_JWT_KEY,
    authorizedParties:
      parties.length > 0 ? parties : ['http://localhost:5173'],
  }
  const client = createClerkClientFromConfig(config)
  return {
    sessions: createClerkSessionAuthenticator(config, client),
    authority: createClerkAuthorityReader(client),
    adminDb,
    verifiedEmails: createClerkVerifiedEmailReader(client),
  }
}
