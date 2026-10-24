# Histórico do design

Registra mudanças nos tokens e nos mocks. Mais recente primeiro. IDs de telas não são renumerados.

## Tokens 0.2.0 — 24/10/2026 (Proposto)

Consolidação dos valores que os mocks 0.1 usavam de forma acidental em escalas pequenas, aplicada aos 26 mocks mobile por regras fixas e conferida por `tools/check_mocks.py`. Os 4 mocks desktop receberam só cores, raios e fontes (sem espaçamento nem alturas) e seguem como referência de layout.

| Dimensão | Antes | Depois | Regra de conversão |
| --- | --- | --- | --- |
| Cores | 35 | 25 | `#F3F3F1`, `#EBEBE8`, `#FAFAF9`, `#EFEFF0` → `#F0F0EE` (surface.sunken); `#E8EEFB`, `#F3F5FB` → `#EEF2FC` (primary.tint); `#8F5600` → `#6E4200` (warning.ink); `#8A1C12` → `#B42318` (danger.ink); `#E9C2BD` → `#CDD0D4` e `#5C130C` → `#474C54` (desabilitado neutro); `#D8CCF3` → `#6B3FD4` (ai.border) |
| Borda de controle | `#CDD0D4` (1,55:1, falhava 3:1) | `#80868F` (3,67:1) | Toda borda `solid`/`dashed` em `#CDD0D4` → `line.control` |
| Fonte | 13 tamanhos (11 a 28) | 6: 12, 14, 16, 18, 22, 26 | 11→12; 13→14; 15→16; 17 e 19→18; 20 e 24→22; 28→26 |
| Raios | 10 valores | 5: 8, 12, 16, 20, 999 | 9 e 10→8; 14→16; 18, 22 e 28→999. Exceções declaradas: 3px (alça da folha) e 4px (canto do balão) |
| Espaçamento | valores soltos (6, 10, 13, 14, 18…) | escala 4, 8, 12, 16, 20, 24, 32 | 6→8; 10→12; 14 e 18→16 em padding, margin e gap. O 13px usado ao lado de uma borda esquerda de 3px permanece |
| Altura de controle pequeno | 32 e 36px | 40px | `height: 32/36px` → 40px. Área clicável continua exigindo ≥ 44px |

Correções de layout feitas junto: faixas de horário de M-17 em 14px (não quebram), selo de papel de M-18 abaixo do e-mail (não sobrepõe), listas com `overflow: hidden` sem encolher em M-15, M-17, M-18 e M-20, rótulo de aba de M-20 (“Salas · 3”).

Novos nesta versão: `tokens.css` (gerado), `catalog/index.html` (catálogo com estados), `tools/check_contrast.py`, `tools/check_mocks.py`, `icons.md`.

## Tokens 0.1.0 — 24/10/2026

Extração inicial dos 26 mocks mobile, sem consolidação.
