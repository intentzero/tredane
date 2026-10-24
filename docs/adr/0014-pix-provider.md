# ADR-0014 — Provedor de Pix para o sinal

- **Estado:** **Proposto**. O método (avaliação na F0) foi confirmado pelo responsável pelo produto em 24/10/2026 ([DEC-047](../product/decisions.md)); a escolha do provedor ainda não.
- **Origem:** [Sinal por Pix](../product/sinal.md), REQ-076 a REQ-082.

## Problema

O sinal precisa de um provedor que gere cobranças Pix **na conta da própria clínica**, avise o pagamento por webhook e permita estorno, sem que o Tredane receba ou repasse dinheiro.

## Critérios da avaliação

1. A clínica recebe na própria conta, conectada pela responsável (por exemplo, por autorização de conta ou chave de API da clínica), sem o Tredane como intermediador do dinheiro.
2. Cobrança Pix com valor, prazo de expiração e identificador próprio do Tredane.
3. Webhook assinado, com reentrega e consulta de estado para reconciliar.
4. Estorno total por API, com estado consultável.
5. Ambiente de testes com pagamentos simulados.
6. Taxas por cobrança e por estorno, para a clínica, medidas e registradas.
7. Documentação, contrato e tratamento de dados compatíveis com a revisão jurídica (LGPD).
8. Funciona chamado de Cloudflare Workers (HTTP com `fetch`, sem SDK que dependa de APIs do Node indisponíveis).

## Opções

A lista de provedores e as condições de cada um **não foram consultadas nesta sessão**. A avaliação na F0 deve levantar ao menos três provedores com Pix no Brasil e preencher uma tabela com os critérios acima, com fonte e data.

## Consequências

- Sem provedor escolhido, a F0 implementa a interface de cobrança atrás de um adaptador e um provedor simulado para testes.
- Trocar de provedor depois afeta só o adaptador e a conexão de conta (M-33).
