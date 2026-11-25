# F2 — Acompanhamento (oportunidades / pipeline)

**Estado:** implementação da issue [#30](https://github.com/intentzero/tredane/issues/30) (épico [#14](https://github.com/intentzero/tredane/issues/14)). Persistência no SQLite do Clinic DO + API HTTP + UI Acompanhamento (M-05 / TEL-03). **Sem** agenda completa (#35/#36), editor livre de etapas, automações de venda nem WhatsApp F3. Dados sintéticos apenas.

## Decisões aplicadas

| DEC / REQ | Comportamento | Estado |
| --- | --- | --- |
| DEC-045 | UI: **Acompanhamento** / **contacto em andamento**; «pipeline»/«oportunidade» só em docs/código | Confirmado |
| DEC-040 | **Agendado** sem compromisso permitido; aviso + **Agendar horário**; mover etapa **não** cria reserva | Confirmado |
| DEC-228 | «Horário proposto» não é coluna; `horario_proposto` legado projeta em **Em atendimento**; Pix pendente é chip **Aguardando Pix** | Confirmado |
| REQ-023 | Etapa, responsável, última interação, próximo compromisso + histórico | Proposto / entregue no MVP-16 |
| AC-08 / AC-16 | Owner e attendant vêem e movem; evento só no tenant | Confirmado na implementação |

## VAL-02 — fixtures (Em aberto / hipótese)

Registado explicitamente no seed e nos testes (não é decisão aprovada):

| Hipótese | Fixture |
| --- | --- |
| Cardinalidade | No máximo **uma** oportunidade `open` por conversa (índice único parcial) |
| Reabertura | Após Concluído/Perdido, `reopen` cria novo ciclo (`cycle_number++`) sem apagar histórico |
| Concluído | Fecha o ciclo (`status=closed`); significado de negócio para a clínica piloto **Em aberto** |
| Por serviço / por ciclo de compra | Não modelado; um ciclo ≈ uma oportunidade open por conversa |

## DEC-187 — cartão gémeo (Confirmado; revisão 16/11/2026)

Com horário futuro + atendimento aberto (sessão `booking_sessions`, proposta, quadro activo/`remarcando`, **«Precisa de alguém»** DEC-156, **ou inbound após a última confirmação**), `listPipelineOpportunities` devolve o ciclo em **Agendado** e um cartão projectado (`cardKind: open_attendance`) em **Em atendimento**. Ao confirmar a nova marcação o gémeo some (merge). `futureAppointmentCount` alimenta o badge N>1 no Agendado. Contagens de coluna incluem o gémeo; o subtítulo largo usa contactos distintos. Colunas vazias do quadro largo: sem «Ninguém aqui». Cartões expõem `needsPerson` e `hasPendingPix`; o Acompanhar mostra os chips e filtros aplicáveis.

## Schema SQLite (migração 5)

Tabelas: `opportunities`, `opportunity_stage_history`.  
Colunas de vínculo em `appointments`: `contact_id`, `conversation_id`, `opportunity_id`.  
`CLINIC_SCHEMA_VERSION = 5`.

Etapas visíveis (DEC-228): `novo_contato` → `em_atendimento` → `agendado` → `concluido` / `perdido`. O valor persistido `horario_proposto` permanece aceito apenas por compatibilidade e projeta em `em_atendimento`.

## APIs

| Método | Path | Quem |
| --- | --- | --- |
| GET | `/api/tenants/:id/pipeline/opportunities` | `clinic.inbox.read` |
| GET | `.../pipeline/opportunities/:id` | idem |
| POST | `.../move` | `clinic.pipeline.move` |
| POST | `.../link-appointment` | `clinic.pipeline.move` (vínculo; não cria reserva) |
| POST | `.../pipeline/reopen` | `clinic.pipeline.move` (VAL-02) |
| POST | `.../pipeline/seed-demo` | seed sintético + inbox |

Eventos realtime (após commit): `opportunity.created`, `opportunity.stage_changed`, `opportunity.appointment_linked`. Snapshot inclui `opportunities` + `opportunityCounts`.

Ingest de mensagem (AC-04) garante oportunidade open na conversa.

## UI (painel)

| Path | Ecrã |
| --- | --- |
| `/c/:tenantId/acompanhamento` | Quadro por etapa (abas) + folha **Mover** |
| `.../acompanhamento/:opportunityId` | Detalhe: histórico, vínculos conversa/contacto/agenda |

Rótulo da barra: **Acompanhar** (360 px); título: **Acompanhamento** (DEC-045).

## Fora de escopo

- Confirmação atómica de horário, grade Dia/Semana, conflitos (#35/#36)
- Webhooks Meta / envio WhatsApp (F3)
- Editor de etapas ou automações de venda

## Testes

- `src/clinic/pipeline/pipeline.test.ts` — schema, AC-04, mover sem agenda, concorrência, VAL-02
- `src/pipeline/http.test.ts` — auth, membership, move, 409 stale, isolamento A/B
- Rotas do painel em `panel.routes.test.tsx`
