// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelScrim } from "./PanelScrim";

afterEach(cleanup);

describe("PanelScrim", () => {
  it("um clique fora chama onClose e a camada fica escondida das tecnologias assistivas", () => {
    const onClose = vi.fn();
    render(<PanelScrim onClose={onClose} />);
    const scrim = screen.getByTestId("panel-scrim");
    expect(scrim.getAttribute("aria-hidden")).toBe("true");
    fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("painéis laterais (CSS)", () => {
  const css = readFileSync(join(__dirname, "../../ui/panel.css"), "utf8");
  const rule = (selector: string) => {
    const m = css.match(
      new RegExp(`${selector.replace(/[.>]/g, "\\$&")}\\s*\\{([^}]*)\\}`),
    );
    return m?.[1] ?? "";
  };

  it.each([
    ".conversas-3col > .conversas-3col-contact",
    ".conversas-3col > .conversas-3col-agendar",
  ])("%s é fixo, do topo ao fundo da janela", (sel) => {
    const body = rule(sel);
    expect(body).toMatch(/position:\s*fixed/);
    expect(body).toMatch(/top:\s*0/);
    expect(body).toMatch(/bottom:\s*0/);
  });

  it("Acompanhar, Agenda e Clínica são fixos, do topo ao fundo", () => {
    const m = css.match(
      /\.acomp-panel,\s*\.agenda-panel,\s*\.clinic-panel\s*\{([^}]*)\}/,
    );
    expect(m?.[1]).toMatch(/position:\s*fixed/);
    expect(m?.[1]).toMatch(/top:\s*0/);
    expect(m?.[1]).toMatch(/bottom:\s*0/);
  });

  it("o conteúdo ao lado não é empurrado quando o painel abre", () => {
    expect(css).not.toMatch(/data-contact='open'\]\s*\.conversas-3col-thread/);
    expect(css).not.toMatch(/data-agendar='open'\]\s*\.conversas-3col-thread/);
    expect(css).not.toMatch(/data-panel='open'\]\s*\.acomp-wide-(board|bar)/);
  });
});
