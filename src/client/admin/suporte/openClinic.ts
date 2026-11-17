/** Abre a Clinic App da clínica (modo suporte). Navegação completa: o cookie da sessão só vale depois dela. */
export function openClinicApp(tenantId: string): void {
  window.location.assign(`/c/${encodeURIComponent(tenantId)}/conversas`)
}
