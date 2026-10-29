import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "react-aria-components";
import { PanelScrim } from "../../ui/PanelScrim";

type Props = {
  title: string;
  /** Fecha o painel (volta à lista). Chamado já sem confirmação pendente. */
  onClose: () => void;
  children: ReactNode;
};

/**
 * Painel de edição da Clínica por cima do conteúdo (desktop ≥ 1280 px, DEC-069): 380 px à direita,
 * sem véu. Fecha com ×, Esc ou «Cancelar» do formulário; foco vai ao painel e volta ao item.
 * Se algo foi digitado, × e Esc pedem confirmação antes de descartar.
 */
export function ClinicPanel({ title, onClose, children }: Props) {
  const ref = useRef<HTMLElement | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const closeRef = useRef<() => void>(() => undefined);

  function requestClose() {
    if (dirty && !confirming) setConfirming(true);
    else onClose();
  }
  closeRef.current = () => {
    if (confirming) setConfirming(false);
    else requestClose();
  };

  useEffect(() => {
    returnTo.current = document.activeElement as HTMLElement | null;
    ref.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const el = returnTo.current;
      if (el && el.isConnected) el.focus({ preventScroll: true });
    };
  }, []);

  return (
    <>
      <PanelScrim onClose={requestClose} />
      <aside
        ref={ref}
        tabIndex={-1}
        className="clinic-panel"
        aria-label={title}
      >
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
          <div
            className="clinic-panel-confirm"
            role="alertdialog"
            aria-label="Descartar alterações"
          >
            <p>Descartar as alterações?</p>
            <div className="clinic-actions">
              <Button
                className="panel-btn-secondary"
                onPress={() => setConfirming(false)}
              >
                Continuar editando
              </Button>
              <Button className="panel-btn-primary" onPress={onClose}>
                Descartar
              </Button>
            </div>
          </div>
        ) : null}
        <div
          className="clinic-panel-body"
          onInput={() => setDirty(true)}
          onChange={() => setDirty(true)}
        >
          {children}
        </div>
      </aside>
    </>
  );
}
