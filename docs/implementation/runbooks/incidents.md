# Runbook — Incidentes do piloto

**Estado:** Proposto · #44 · REQ-070 / AC-15

## Severidade

| Severidade | Exemplos | Resposta |
| --- | --- | --- |
| critical | DLQ a crescer, schema mismatch, falha Meta/Pix em massa, vazamento cross-tenant | Interromper deploys; runbook unavailable + reprocess; escalar produto |
| warning | Outbox stale, IA indisponível, purge perto do deadline | Diagnosticar com correlação; prazo interno |
| info | Revogação esperada, smoke falhou em harness | Registo; sem page |

## Correlação

Campos obrigatórios nos logs técnicos:

- `correlationId`, `tenantId` (id interno), `channel`, `event`, `operation`, `stage`, `outcome`

Proibidos: corpos, telefones, tokens, nomes, e-mails, params de modelo.

Validar scrub: `POST /api/f6/ops/log/scrub-check`.

## Comunicação

- Interno: ticket com IDs técnicos e `correlationId` — **sem** colar payloads.
- Clínica piloto: linguagem do painel (estado compreensível); sem jargão de fila.
- Dados reais: só após GATE-04; até lá apenas sintéticos.

## Pós-incidente

1. Linha do tempo com correlationIds.
2. Falha injectável reproduzida no harness quando possível.
3. Actualizar limiares Propostos se a medição live divergir (não promover a Confirmado sem revisão).
4. Ligar a AC-15 / REQ-013 se houver lacuna de observabilidade.

## Incidentes de IA

**Estado:** **Proposto** (30/10/2026). Três casos. Preocupação de uma pessoa sem falha técnica: [ai-concern.md](ai-concern.md). Em todos: ticket interno só com ids e `correlationId`, sem corpo de mensagem, telefone ou prompt. A clínica piloto ouve linguagem do painel. Dados reais só após GATE-04.

| Caso | Severidade | O que fazer |
| --- | --- | --- |
| Sugestão ou contexto com dado de outra clínica | critical | Parar o caminho de IA dessa clínica (sugestões e propostas novas). Não reenviar o texto. Produto avisa a responsável de que uma resposta pode ter misturado clínicas, sem colar o conteúdo. Engenharia confirma isolamento antes de retomar. |
| Marcação indevida pelo botão | warning | A responsável pausa marcações novas ([ai-autobook-kill-switch.md](ai-autobook-kill-switch.md)). Compromissos já feitos permanecem até a equipe decidir um a um. Não há cancelamento em massa. Produto diz à clínica o id do compromisso e que a equipe confirma ou cancela pelo fluxo normal. |
| Conteúdo de conversa no log do Gateway | critical | Tratar como NC-04 no [registo](../../security/aims-register.md). Desligar o uso com dados reais (já bloqueado até GATE-06). Engenharia guarda a evidência do dashboard sem copiar o prompt para o ticket. Jurídico entra no GATE-06. |

Quem avisa a clínica é produto, no mesmo dia em que o caso é confirmado. Engenharia não escreve à cliente final.
