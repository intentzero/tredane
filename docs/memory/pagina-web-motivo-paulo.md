# Porque a página web substitui o Flow (Paulo, 17/11/2026)

**Estado:** **Confirmado** (DEC-196; origem nas respostas do Paulo ao planeamento de 17/11/2026).

## Problema

O agendamento **só por conversa** continuava frágil: a sonda de novembro de 2026 (DEC-138) mostrou zona que cai, dia perdido no toque, Confirmar em proposta expirada e dezenas de correções no núcleo. O WhatsApp Flow (DEC-138 / ADR-0016) era o caminho principal previsto, mas depende da verificação de negócio da Meta, bloqueada sem CNPJ (VAL-13, #514).

## Decisão do Paulo

- **Substitui o Flow** por uma página web aberta por link pessoal no chat: agendar, remarcar, cancelar e ver marcações de forma determinística.
- A **conversa** fica para informar e esclarecer e continua como **alternativa** (DEC-104, DEC-185).
- DEC-138 (caminho Flow) e ADR-0016 passam a **Suspenso**; o código e o desenho do Flow preservam-se até nova decisão.

## O que não muda nesta decisão

- Texto livre no chat **nunca marca** (DEC-061(2)).
- Pix no chat (DEC-047/049); a página não pede pagamento.
- O LLM não escolhe serviço, zona nem hora na página.

## Ligações

- [DEC-196](../product/decisions.md) · [ADR-0018](../adr/0018-pagina-web-cliente.md) · [MVP.md](../MVP.md) (secção página web da cliente)