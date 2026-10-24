# F5 — IA assistiva via AI Gateway (revisão humana)

**Estado:** implementação da issue [#41](https://github.com/intentzero/tredane/issues/41) (épico [#14](https://github.com/intentzero/tredane/issues/14)). DEC-011/040/046; REQ-022/072–075; AC-06/37/41–43. **Não** absorve PWA (#42). Dados sintéticos / `AI_MODE=synthetic` até GATE-06 + revisão jurídica.

## Decisões aplicadas (Confirmado)

| DEC / REQ | Comportamento |
| --- | --- |
| DEC-040 / REQ-022 / AC-06 | Sugestão só sob demanda; identificada; Usar e editar / Gerar outra / Descartar; envio só pelo compositor |
| DEC-011 / REQ-072 / AC-37 | Contexto: mensagens recentes (limite **Proposto** 20), primeiro nome, catálogo, etapa; nunca telefone, anexos, outras conversas/tenants |
| DEC-046 / REQ-073 / AC-41 | Preço só do cadastro; sem preço → aviso + «equipe confirma» |
| DEC-046 / REQ-074 / AC-42 | Ofensiva/fora do assunto → aviso + resposta cordial |
| DEC-046 / REQ-075 / AC-43 | Explicação só do campo «Explicação para clientes»; clínico → encaminhar profissional |
| ADR-0004 | Claude via AI Gateway; sem respostas/agendamentos autónomos |

## Schema SQLite (migração 14)

- `ai_suggestions` — texto, modelo, avisos, métricas sem PII, decisão humana
- `ai_commands` — idempotência de suggest/summarize/decide
- `outbound_messages.ai_suggestion_id` / `ai_origin_note` — origem interna após Enviar

`CLINIC_SCHEMA_VERSION = 14`.

## Fluxo

1. Atendente toca **Sugerir** (Sparkles) → Worker → Clinic DO → contexto mínimo → adaptador (`synthetic` ou Gateway).
2. Bloco de IA acima do compositor; **sem** botão Enviar no bloco.
3. **Usar e editar** copia para o compositor; **Enviar** humano liga `aiSuggestionId`.
4. Timeout/rate limit → aviso «pode responder normalmente»; compositor ativo.
5. Resumo sob demanda no painel do contacto (M-03).

## Adaptadores

| Modo | Uso |
| --- | --- |
| `AI_MODE=synthetic` (default) | `SimulatedAiAdapter` — CI e local sem chaves |
| `AI_MODE=gateway` | Claude via `gateway.ai.cloudflare.com/.../anthropic/v1/messages` com `cf-aig-collect-log-payload: false` |

## APIs

| Método | Path | Quem |
| --- | --- | --- |
| POST | `/api/tenants/:id/conversations/:cnv/ai/suggest` | `clinic.inbox.reply` |
| POST | `/api/tenants/:id/conversations/:cnv/ai/summarize` | `clinic.inbox.read` |
| POST | `/api/tenants/:id/ai/suggestions/:id/decide` | `clinic.inbox.reply` |
| GET | `/api/tenants/:id/conversations/:cnv/ai/suggestions` | `clinic.inbox.read` |

## Em aberto / fora deste PR

- GATE-06: evidência de logging de payload desligado + não retenção Anthropic
- Critérios finos de detecção ofensiva/clínico (**Em aberto** / Proposto)
- Limite 20 mensagens e budgets — medir com piloto
- PWA / push — ver [f5-pwa-push.md](f5-pwa-push.md) (#42)
- Dados reais de pacientes
