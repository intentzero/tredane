// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("compositor mobile / iOS teclado", () => {
  it("viewport pede interactive-widget=resizes-content", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    expect(html).toMatch(/interactive-widget=resizes-content/);
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