/** Camada transparente por trás de um painel lateral: clicar fora fecha o painel, sem véu visual. */
export function PanelScrim({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="panel-scrim"
      aria-hidden="true"
      data-testid="panel-scrim"
      onClick={onClose}
    />
  );
}
