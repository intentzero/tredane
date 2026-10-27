/** Sessão por aba: synthetic Bearer e clínica ativa em sessionStorage (#22). */

const SYNTH_USER_KEY = 'tredane.synthUserId'
const ACTIVE_TENANT_KEY = 'tredane.activeTenantId'

export function readSynthUserId(): string | null {
  try {
    return sessionStorage.getItem(SYNTH_USER_KEY)
  } catch {
    return null
  }
}

export function writeSynthUserId(userId: string | null): void {
  try {
    if (userId) sessionStorage.setItem(SYNTH_USER_KEY, userId)
    else sessionStorage.removeItem(SYNTH_USER_KEY)
  } catch {
    /* private mode */
  }
}

export function synthBearer(userId: string): string {
  return `synth:${userId}`
}

export function readActiveTenantId(): string | null {
  try {
    return sessionStorage.getItem(ACTIVE_TENANT_KEY)
  } catch {
    return null
  }
}

export function writeActiveTenantId(tenantId: string | null): void {
  try {
    if (tenantId) sessionStorage.setItem(ACTIVE_TENANT_KEY, tenantId)
    else sessionStorage.removeItem(ACTIVE_TENANT_KEY)
  } catch {
    /* private mode */
  }
}

const LAST_TENANT_KEY = 'tredane.lastTenantId'
const PICKING_KEY = 'tredane.pickingClinic'

/**
 * Última clínica aberta neste aparelho (localStorage, sobrevive a fechar o app).
 * Só guarda o identificador: ao reabrir, o vínculo é sempre revalidado no servidor
 * (DEC-017) e o id só vale se estiver na lista de clínicas da pessoa logada.
 */
export function readLastTenantId(): string | null {
  try {
    return localStorage.getItem(LAST_TENANT_KEY)
  } catch {
    return null
  }
}

export function writeLastTenantId(tenantId: string | null): void {
  try {
    if (tenantId) localStorage.setItem(LAST_TENANT_KEY, tenantId)
    else localStorage.removeItem(LAST_TENANT_KEY)
  } catch {
    /* private mode */
  }
}

/** A pessoa tocou em «Trocar clínica»: o seletor não pode reabrir a última sozinho. */
export function markPickingClinic(): void {
  try {
    sessionStorage.setItem(PICKING_KEY, '1')
  } catch {
    /* private mode */
  }
}

export function isPickingClinic(): boolean {
  try {
    return sessionStorage.getItem(PICKING_KEY) === '1'
  } catch {
    return false
  }
}

export function clearPickingClinic(): void {
  try {
    sessionStorage.removeItem(PICKING_KEY)
  } catch {
    /* private mode */
  }
}

/** Personas sintéticas fictícias alinhadas a db/seed.sql — só development. */
export const SYNTH_PERSONAS = [
  {
    clerkUserId: 'user_synth_multi',
    label: 'Renata (multi-clínica)',
    detail: 'Owner em Aurora · Atendente em Horizonte',
  },
  {
    clerkUserId: 'user_synth_owner_a',
    label: 'Bruno (responsável Aurora)',
    detail: 'Owner · Clínica Aurora (fictícia)',
  },
  {
    clerkUserId: 'user_synth_attendant_a',
    label: 'Carla (atendente Aurora)',
    detail: 'Atendente · sem aba Clínica',
  },
  {
    clerkUserId: 'user_synth_owner_b',
    label: 'Diego (responsável Horizonte)',
    detail: 'Owner · Estúdio Horizonte (fictício)',
  },
  {
    clerkUserId: 'user_synth_no_access',
    label: 'Sem membership',
    detail: 'Login ok · nenhuma clínica (REQ-005)',
  },
] as const
