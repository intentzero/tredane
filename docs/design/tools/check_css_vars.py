#!/usr/bin/env python3
"""Falha se o CSS ou o JSX do painel usar var(--x) que não existe.

Uma variável é válida se:
  - está em src/client/ui/tokens.css (gerado de tokens.json), ou
  - é declarada no próprio CSS do painel (propriedade local, ex.: --row-h), ou
  - é uma variável que a biblioteca define em tempo de execução (RUNTIME_VARS).

Motivo: `var(--color-primary, #2f5bd3)` com token inexistente cai sempre no valor
de reserva e esconde a cor da marca; trocar tokens (v0.3) não mudaria a tela.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
UI = ROOT / "src" / "client"
TOKENS = UI / "ui" / "tokens.css"

# Definidas pelo React Aria Components em tempo de execução.
RUNTIME_VARS = {
    "--trigger-width",
    "--visual-viewport-height",
}

DECL = re.compile(r"(--[a-z0-9-]+)\s*:")
USE = re.compile(r"var\(\s*(--[a-z0-9-]+)")


def main() -> int:
    files = [p for p in UI.rglob("*") if p.suffix in {".css", ".tsx", ".ts"} and ".test." not in p.name]
    defined = set(RUNTIME_VARS)
    for p in files:
        if p.suffix == ".css":
            defined |= set(DECL.findall(p.read_text(encoding="utf-8")))
    defined |= set(DECL.findall(TOKENS.read_text(encoding="utf-8")))

    problems = []
    for p in files:
        for n, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
            for name in USE.findall(line):
                if name not in defined:
                    problems.append(f"{p.relative_to(ROOT)}:{n}: {name} não existe em tokens.css")

    if problems:
        print("Variáveis CSS sem token:")
        print("\n".join(problems))
        print("\nUse um token de docs/design/tokens.json. Se falta um valor, registre a divergência; não invente.")
        return 1
    print(f"Todas as variáveis CSS do painel existem ({len(files)} arquivos verificados)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
