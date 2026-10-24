export type {
  HumanPrincipal,
  IntegrationPrincipal,
  Principal,
  TenantContext,
  Permission,
  SessionAuthResult,
  UserAuthoritySnapshot,
} from './types'
export { AuthError, isAuthError } from './errors'
export {
  ALL_PERMISSIONS,
  permissionsForClinicRole,
  permissionsForPlatformSuperadmin,
  roleAllows,
  platformAllows,
} from './permissions'
export { isExactPrivateSuperadmin, assertSuperadminFromAuthority, requireVerifiedSuperadmin } from './superadmin'
export {
  requireSession,
  assertCookieOriginAllowed,
  requestUsesBearer,
  type SessionAuthenticator,
} from './session'
export {
  createClerkSessionAuthenticator,
  createClerkAuthorityReader,
  createClerkClientFromConfig,
  type ClerkAuthConfig,
} from './clerk-backend'
export {
  createSyntheticSessionAuthenticator,
  createSyntheticAuthorityReader,
  synthAuthHeader,
  DEFAULT_SYNTH_FIXTURES,
  SYNTH_BEARER_PREFIX,
} from './synthetic'
export {
  authenticateHuman,
  authenticateHumanWithOptionalSuperadmin,
  listPrincipalTenants,
  resolveTenantContext,
  requireClinicPermission,
  requirePlatformPermission,
  listPlatformTenants,
  denyUnverifiedIntegration,
  type AuthServices,
} from './authorize'
export {
  createAuthServicesMiddleware,
  requireAuth,
  requireSuperadmin,
  requireTenantAccess,
  authErrorResponse,
  adminDbFromEnv,
  adminDbFromSync,
  type AuthEnv,
  type AuthDepsFactory,
} from './middleware'
export { buildAuthServices, type WorkerAuthEnv } from './deps'
export { createAuthRoutes } from './routes'
