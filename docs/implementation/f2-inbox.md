# F2 — Contatos, caixa de entrada e histórico partilhado

**Estado:** implementação da issue [#29](https://github.com/intentzero/tredane/issues/29) (épico [#14](https://github.com/intentzero/tredane/issues/14)). Persistência no SQLite do Clinic DO + API HTTP + UI Conversas (M-01/02/03). **Sem** Acompanhamento (#30), webhooks Meta (F3) nem envio real WhatsApp. Dados sintéticos apenas.

## Decisões aplicadas

| DEC / REQ | Comportamento | Estado |
| --- | --- | --- |
| DEC-015 / AC-16 | Owner e attendant vêem todas as conversas da clínica, inclusive atribuídas a outros | Confirmado |
| DEC-016 | Owner opera as mesmas ações de atendimento (assumir, responder simulado, encerrar) | Confirmado |
| REQ-010 | Contacto + conversa por tenant; mesmo `waId` em A e B é independente | Confirmado na implementação |
| REQ-020 | Lista, filtros, assumir/transferir com membership D1 vigente | Confirmado (visibilidade); atribuição Proposta |
| REQ-021 | Histórico paginado; reconciliação via snapshot/eventos WS | Proposto / entregue no MVP-15 |
| states.md | Atribuição separada do estado da conversa (`new`/`open`/`closed`) | Proposto |

## Hipótese documentada (Em aberto)

- **Uma conversa por contacto:** nova mensagem reabre a conversa se estiver `closed`; histórico nunca é apagado.
- Motivo de encerramento, campos mínimos extras do contacto e anexos: fora deste PR (produto).
- Resposta outbound é **simulada** (`delivery_state=accepted`) até F3.

## Schema SQLite (migração 4)

Tabelas: `conversations`, `messages`.  
`CLINIC_SCHEMA_VERSION = 4`.

## APIs

| Método | Path | Quem |
| --- | --- | --- |
| GET | `/api/tenants/:id/inbox/conversations` | owner + attendant (`clinic.inbox.read`) |
| GET | `.../inbox/conversations/:id` | idem |
| GET | `.../inbox/contacts/:id` | idem |
| POST | `.../assign` · `/read` · `/close` · `/messages` | `clinic.inbox.reply` |
| POST | `.../inbox/seed-demo` | seed sintético |

Filtros: `all` \| `new` \| `mine` \| `unassigned` \| `closed`.  
Transferência valida membership ativa no D1. Concorrência: last-write-wins + `assignmentVersion`; `expectedAssignmentVersion` desalinhado → 409 com vencedor persistido.

Eventos realtime (após commit): `message.created`, `conversation.created|updated|assigned|closed|read`, além de `contact.upserted`. Snapshot `/realtime/snapshot` inclui `conversations` + `inboxCounts`.

## UI (painel)

| Path | Ecrã |
| --- | --- |
| `/c/:tenantId/conversas` | Lista M-01 |
| `.../conversas/:conversationId` | Thread M-02 |
| `.../conversas/:conversationId/contato` | Ficha contacto (sem pipeline #30) |

Conteúdo externo renderizado só como texto React (sem HTML executável).

## Testes

- `src/clinic/inbox/inbox.test.ts` — isolamento multi-tenant, dedup, atribuição concorrente, DEC-015, paginação, reopen
- `src/inbox/http.test.ts` — auth, membership, XSS-as-text
- Rotas do painel atualizadas em `panel.routes.test.tsx`
