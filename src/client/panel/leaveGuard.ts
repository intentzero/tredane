/**
 * Impede sair de uma ficha com alterações por salvar (ficha do serviço).
 * `navigatePanel` consulta o guarda antes de mudar o endereço.
 * O voltar do navegador é desfeito até a pessoa escolher.
 */

type LeaveGuard = {
  isDirty: () => boolean
  ask: (proceed: () => void) => void
}

let guard: LeaveGuard | null = null
let skipping = false
let armedHref = ''
let installed = false

function hrefNow(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

export function setLeaveGuard(next: LeaveGuard | null): void {
  guard = next
}

/** Aplica a mudança de endereço, ou pede confirmação se a ficha estiver suja. */
export function commitPanelHref(href: string, replace: boolean): void {
  const apply = () => {
    if (replace) window.history.replaceState(null, '', href)
    else window.history.pushState(null, '', href)
    armedHref = hrefNow()
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
  if (skipping || !guard?.isDirty()) {
    skipping = false
    apply()
    return
  }
  guard.ask(() => {
    skipping = true
    try {
      apply()
    } finally {
      skipping = false
    }
  })
}

function onPop(): void {
  const next = hrefNow()
  if (next === armedHref) return
  if (skipping || !guard?.isDirty()) {
    armedHref = next
    return
  }
  const intended = next
  window.history.pushState(null, '', armedHref)
  guard.ask(() => {
    skipping = true
    try {
      window.history.pushState(null, '', intended)
      armedHref = hrefNow()
      window.dispatchEvent(new PopStateEvent('popstate'))
    } finally {
      skipping = false
    }
  })
}

export function installLeaveGuard(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  armedHref = hrefNow()
  window.addEventListener('popstate', onPop, true)
}

installLeaveGuard()
