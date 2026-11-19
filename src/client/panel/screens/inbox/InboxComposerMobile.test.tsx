// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("compositor mobile / iOS teclado", () => {
  it("viewport pede interactive-widget=resizes-content", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    expect(html).toMatch(/interactive-widget=resizes-content/);
  });

  it("CSS: com teclado (campo focado) o shell inteiro prende ao visualViewport", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/client/ui/panel.css"),
      "utf8",
    );
    // Clínica FAQ / Agenda / thread: sem pin a tab bar sobe com vão por baixo (iOS).
    expect(css).toMatch(
      /:root\[data-keyboard=['"]open['"]\]\s*\.panel-app\s*\{[^}]*top:\s*var\(--panel-vv-top/s,
    );
    expect(css).toMatch(
      /:root\[data-keyboard=['"]open['"]\]\s*\.panel-app\s*\{[^}]*height:\s*var\(--panel-vvh\)/s,
    );
    // Fora do teclado o shell continua em inset:0 (não há height:vvh sem data-keyboard).
    expect(css).toMatch(/\.panel-app\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/s);
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
