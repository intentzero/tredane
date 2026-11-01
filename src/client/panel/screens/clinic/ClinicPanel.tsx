import { X } from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Button } from 'react-aria-components'
import { useOutsideClose } from '../../ui/useOutsideClose'

type CloseGuard = {
  isDirty: () => boolean
  save: () => Promise<void>
  /**
   * `delegate`: a ficha mostra o próprio diálogo e o painel só chama onClose
   * (a navegação é que pergunta). Usado na ficha do serviço.
   */
  prompt?: 'delegate'
}

type GuardApi = {
  register: (guard: CloseGuard | null) => void
}

const ClinicPanelGuardContext = createContext<GuardApi | null>(null)

/** A ficha regista rascunho + gravar para × / Esc do painel (DEC-083). */
export function useClinicPanelCloseGuard(guard: CloseGuard | null) {
  const api = useContext(ClinicPanelGuardContext)
  useEffect(() => {
    api?.register(guard)
    return () => api?.register(null)
  }, [api, guard])
}

type Props = {
  title: string
  /** Fecha o painel (volta à lista). Chamado já sem confirmação pendente. */
  onClose: () => void
  children: ReactNode
}

/**
 * Painel de edição da Clínica por cima do conteúdo (desktop ≥ 1280 px, DEC-069): 380 px à direita,
 * sem véu. Fecha com ×, Esc ou «Cancelar» do formulário; foco vai ao painel e volta ao item.
 * Com rascunho: diálogo gravar / descartar / continuar (DEC-083).
 */
export function ClinicPanel({ title, onClose, children }: Props) {
  const ref = useRef<HTMLElement | null>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  const guardRef = useRef<CloseGuard | null>(null)
  const [fallbackDirty, setFallbackDirty] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const closeRef = useRef<() => void>(() => undefined)

  const register = useCallback((guard: CloseGuard | null) => {
    guardRef.current = guard
  }, [])

  function isDirty() {
    return guardRef.current?.isDirty() ?? fallbackDirty
  }

  function requestClose() {
    if (guardRef.current?.prompt === 'delegate') {
      onClose()
      return
    }
    if (isDirty() && !confirming) setConfirming(true)
    else onClose()
  }

  closeRef.current = () => {
    if (confirming) setConfirming(false)
    else requestClose()
  }

  useOutsideClose(ref, () => closeRef.current())

  useEffect(() => {
    returnTo.current = document.activeElement as HTMLElement | null
    ref.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      const el = returnTo.current
      if (el && el.isConnected) el.focus({ preventScroll: true })
    }
  }, [])

  async function saveAndClose() {
    const save = guardRef.current?.save
    if (!save) {
      onClose()
      return
    }
    setSaving(true)
    try {
      await save()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <ClinicPanelGuardContext.Provider value={{ register }}>
      <aside ref={ref} tabIndex={-1} className="clinic-panel" aria-label={title}>
        <header className="clinic-panel-head">
          <h2 className="panel-title">{title}</h2>
          <Button
            className="panel-icon-btn"
            aria-label={`Fechar ${title.toLowerCase()}`}
            onPress={requestClose}
          >
            <X aria-hidden size={20} strokeWidth={2} />
          </Button>
        </header>
        {confirming ? (
          <div className="clinic-panel-confirm" role="alertdialog" aria-label="Alterações não salvas">
            <p>Alterações não salvas. Pode gravar, descartar ou continuar a editar.</p>
            <div className="clinic-actions">
              <Button
                className="panel-btn-primary"
                isDisabled={saving}
                onPress={() => void saveAndClose()}
              >
                {saving ? 'Salvando…' : 'Gravar'}
              </Button>
              <Button
                className="panel-btn-secondary"
                isDisabled={saving}
                onPress={onClose}
              >
                Descartar
              </Button>
              <Button
                className="panel-btn-secondary"
                isDisabled={saving}
                onPress={() => setConfirming(false)}
              >
                Continuar a editar
              </Button>
            </div>
          </div>
        ) : null}
        <div
          className="clinic-panel-body"
          onInput={() => setFallbackDirty(true)}
          onChange={() => setFallbackDirty(true)}
        >
          {children}
        </div>
      </aside>
    </ClinicPanelGuardContext.Provider>
  )
}
