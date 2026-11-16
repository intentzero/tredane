/** Manda para a entrada do painel (Clerk ou synthetic); o retorno a /admin é tratado em PanelApp. */
export function navigatePanelToLogin(): void {
  window.history.replaceState(null, '', '/entrar')
  window.location.reload()
}
