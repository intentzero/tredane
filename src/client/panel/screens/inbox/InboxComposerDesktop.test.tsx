// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("compositor desktop — largura e teclado", () => {
  const thread = readFileSync(
    resolve(process.cwd(), "src/client/panel/screens/inbox/InboxThread.tsx"),
    "utf8",
  );
  const css = readFileSync(
    resolve(process.cwd(), "src/client/ui/panel.css"),
    "utf8",
  );

  it("desktop ≥1024: dock sem teto de 680 px (full width da coluna)", () => {
    const block = css.match(
      /@media \(min-width: 1024px\)\s*\{\s*\.conversas-3col \.inbox-dock\s*\{[^}]+\}/s,
    );
    expect(block?.[0]).toBeTruthy();
    expect(block?.[0]).toMatch(/max-width:\s*none/);
    expect(block?.[0]).not.toMatch(/max-width:\s*680px/);
  });

  it("Enter envia no desktop; Shift+Enter e celular não", () => {
    expect(thread).toMatch(/if \(narrow\) return/);
    expect(thread).toMatch(
      /if \(e\.key === ["']Enter["'] && !e\.shiftKey\)/,
    );
    expect(thread).not.toMatch(
      /\(e\.metaKey \|\| e\.ctrlKey\) && e\.key === ["']Enter["']/,
    );
  });
});
