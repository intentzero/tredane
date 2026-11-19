// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("compositor mobile / iOS teclado", () => {
  it("viewport pede interactive-widget=resizes-content", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    expect(html).toMatch(/interactive-widget=resizes-content/);
  });

  it("CSS: só a thread prende o shell ao visualViewport (top + height); tab bar fica em inset:0", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/client/ui/panel.css"),
      "utf8",
    );
    expect(css).toMatch(
      /:root\[data-keyboard=['"]open['"]\]\s*\.panel-app:has\(\.inbox-thread\)\s*\{[^}]*top:\s*var\(--panel-vv-top/s,
    );
    expect(css).toMatch(
      /:root\[data-keyboard=['"]open['"]\]\s*\.panel-app:has\(\.inbox-thread\)\s*\{[^}]*height:\s*var\(--panel-vvh\)/s,
    );
    // Não encolher todo o .panel-app (Clínica / Agenda / …) — a barra subia.
    expect(css).not.toMatch(
      /:root\[data-keyboard=['"]open['"]\]\s*\.panel-app\s*,/,
    );
  });

  it("CSS: compositor sticky com data-keyboard=open", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/client/ui/panel.css"),
      "utf8",
    );
    expect(css).toMatch(
      /:root\[data-keyboard=['"]open['"]\]\s*\.inbox-composer-wrap\s*\{[^}]*position:\s*sticky/s,
    );
  });
});
