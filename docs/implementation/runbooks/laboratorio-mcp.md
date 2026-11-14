# Laboratório conversacional (MCP) — como usar

**Estado:** Confirmado (DEC-182, Paulo, 14/11/2026). Fase 1 implementada; fase 2 (configurar a clínica) **Proposta**.

Um MCP com escrita, **separado** do Review MCP (que é só leitura, DEC-159), para um agente conversar com o sistema
como se fosse uma cliente, sem WhatsApp, e ler o estado da clínica. Serve para testes conversacionais repetíveis e
para reproduzir um defeito antes de o tratar (caso L1 primeiro; ver `metodologia-avaliacao-conversacional.md`).

## Limites (não se contornam)

- **Só staging** (`ENVIRONMENT=staging`) e **só a clínica demo** (`tenant_dec0de000000000000000001`). Sem tenant novo.
- Gate triplo, como o seed demo: var `LAB_ENABLED=true` (já em `wrangler.jsonc`, staging), secret `LAB_TOKEN`
  (≥ 32 caracteres) e `Authorization: Bearer <LAB_TOKEN>`. Sem secret a rota responde 404.
- **Nada sai para a Meta.** O consumer já ignora o tenant demo; o resultado do envio é marcado como entregue de forma
  sintética para a proposta avançar. Números só `5500…` (inexistentes); outro prefixo é recusado.
- **Orçamento:** teto diário de turnos (`LAB_MAX_TURNS_DAILY`, padrão 400), proxy do teto de US$ 10 dos testes L2.
  Esgotado, o turno é recusado antes de qualquer efeito. Cada `lab_say` chama o modelo; `lab_tap` e `lab_state` não
  chamam, mas `lab_tap` conta no teto para manter a regra simples.
- Os dados do laboratório vivem na clínica demo e misturam-se com o seed; não usar para medir produção.

## Ligar

```bash
npx wrangler secret put LAB_TOKEN --env staging   # colar um valor aleatório de 32+ caracteres
```

Depois do deploy de staging, registar o MCP no cliente (URL `https://<staging>/api/mcp/lab`, cabeçalho
`Authorization: Bearer <LAB_TOKEN>`; JSON-RPC por POST, sem sessão). Nunca versionar o token.

## Ferramentas (fase 1)

| Ferramenta | O que faz |
| --- | --- |
| `lab_status` | Tenant demo, teto diário e turnos usados. Chamar primeiro. |
| `lab_say` | A cliente envia texto; a IA responde já (sem esperar o debounce). Devolve as mensagens novas e `tappable` (botões/lista a tocar). |
| `lab_tap` | A cliente toca num botão ou numa linha de lista (`buttonId` e `title` vêm de `options`/`tappable`; `kind: "list"` para listas). Só o botão Confirmar marca (DEC-061). |
| `lab_state` | Contato, conversa, mensagens, propostas, jobs da IA e marcações da clínica. Só leitura. |

`waId` omitido usa `550000000001`; outro número (`5500…`) é outra cliente, com conversa própria.

## Receita de um teste

1. `lab_status`; 2. `lab_say` com a frase do caso; 3. se a resposta traz opções, `lab_tap` com um id devolvido;
4. `lab_state` para ver proposta e marcação; 5. repetir com variantes da frase (a escolha entre frases aprovadas varia
por conversa: usar `waId` diferentes). Um defeito confirmado vira um caso L1 em
`src/clinic/ai/evals/dialogs/cc-cases.ts` antes da correção.

## Fase 2 (Proposta, não implementada)

Configurar serviços, variantes, salas e atendentes pelas operações existentes do DO (as mesmas do painel), com o
mesmo gate. Pix e cobrança ficam fora. Falta decidir: o conjunto mínimo de operações e um «repor seed» do tenant demo.
