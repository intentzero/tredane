# Regra: Proposto não vira Confirmado

**Estado:** **Confirmado** como norma de documentação ([AGENTS.md](../../AGENTS.md)); não é uma DEC de produto.

## Regra

Um item marcado **Proposto** (hipótese, recomendação, desenho de engenharia, valores por omissão) **não** deve ser tratado como **Confirmado** só porque parece tecnicamente conveniente ou porque já existe código atrás de flag.

Só passa a **Confirmado** com decisão **explícita** do responsável pelo produto (Paulo) — frase registada na DEC, na ADR ou na memória com data.

## Exemplos na página web (17/11/2026)

| Tema | Confirmado | Proposto (não promover) |
| --- | --- | --- |
| Substituir o Flow | Sim (DEC-196) | — |
| Token 60 min / sessão 30 min | Significado de «uso único» | Valores numéricos (DEC-199) |
| Cancelar com sinal | Direção «sim, sempre» (DEC-198) | Regra até aplicar janela de crédito |
| Pesquisa e «Para quem é?» | Pedido do Paulo (DEC-200) | Desenho da UX |
| Sinónimos no navegador | «Aceitar» (não mostrar à cliente) | — |
| Textos do hub / remarcar / cancelar | Oferecer o link | Corpo das mensagens |

## Ligações

- [AGENTS.md](../../AGENTS.md) — secção «Estado das afirmações»
- [em-aberto-pagina-web-cliente.md](em-aberto-pagina-web-cliente.md)