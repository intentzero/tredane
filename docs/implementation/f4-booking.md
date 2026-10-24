# F4 — Agendamento atómico, dia/semana e alterações com motivo

**Estado:** implementação da issue [#36](https://github.com/intentzero/tredane/issues/36) (épico [#14](https://github.com/intentzero/tredane/issues/14)). Confirmação / cancelamento / reagendamento no SQLite do Clinic DO numa `transactionSync`; visões dia/semana; motivo obrigatório. **Sem** Pix (#37+), sem recorrência, sem reserva temporária. Dados sintéticos apenas.

## Decisões aplicadas (Confirmado)

| DEC / REQ | Comportamento |
| --- | --- |
| DEC-008 | Cancelar/reagendar sem prazo mínimo; motivo obrigatório de lista; buffer ocupa profissional e sala |
| DEC-040 | Visão dia e semana; «Agendado» sem compromisso continua permitido no pipeline (mover etapa não cria reserva) |
| REQ-031 / AC-09 | Duas confirmações no mesmo recurso/intervalo → no máximo uma; a outra recebe conflito útil |
| REQ-032 / AC-10 / AC-36 | Motivo obrigatório; conflito no reagendar preserva o compromisso anterior |
| REQ-033 | Mensagem WhatsApp é envio humano via inbox (#33); falha de envio **não** altera a reserva |
| REQ-034 | Agenda dia/semana com isolamento por tenant |
| ADR-0005 / ADR-0012 | Validar + gravar compromisso, alocações, histórico e outbox na mesma TX; sem I/O externo na TX |

## Migração

`0009_appointments_booking` (schema clinic v9):

- Colunas em `appointments`: `version`, `updated_at`, `confirmed_by/at`, `change_reason`, `cancelled_by/at`, `occupies_until`
- `appointment_allocations` — ocupação por recurso (profissional + sala/equipamento)
- `appointment_events` — histórico `confirmed` / `cancelled` / `rescheduled`
- `appointment_commands` — idempotência por `client_request_id` (clique/retry)

## Algoritmo de confirmação

1. Idempotência: se `client_request_id` já existir → devolver o mesmo compromisso (`idempotentReplay`).
2. Dentro de `transactionSync`: revalidar slot (`checkSlotAvailability`); se livre, INSERT appointment + allocations + event + outbox (+ vínculo oportunidade se pedido).
3. Fan-out WS / drain de outbox **depois** do commit (padrão DO).
4. Conflito → `ConflictError` 409 com `reasons[]`; nada gravado.

## Cancelamento e reagendamento

- Motivos (**Proposto**, REQ-032): `contato_desistiu`, `contato_remarcou`, `clinica_cancelou`, `nao_compareceu`, `outro`.
- Cancelar: `status=cancelled`, remove alocações, histórico + outbox; `expectedVersion` opcional (TEL-06).
- Reagendar: exclui o próprio ID na verificação; em conflito a TX faz rollback e o horário antigo permanece; em sucesso substitui alocações atomicamente.

## APIs

| Método | Path | Quem |
| --- | --- | --- |
| GET | `/api/tenants/:id/agenda?date&view=day\|week` | `clinic.agenda.operate` |
| GET | `/api/tenants/:id/appointments/reasons` | idem |
| GET | `/api/tenants/:id/appointments/:id` | idem |
| POST | `/api/tenants/:id/appointments` | confirmar (`clientRequestId` obrigatório) |
| POST | `…/appointments/:id/cancel` | motivo + `clientRequestId` |
| POST | `…/appointments/:id/reschedule` | motivo + novo slot + `clientRequestId` |

Disponibilidade (#35) inalterada: `GET/POST …/availability`.

## UI (painel)

| Path | Ecrã |
| --- | --- |
| `/c/:tenantId/agenda` | Dia (M-06) |
| `/c/:tenantId/agenda/semana` | Semana (M-13) |
| `/c/:tenantId/agenda/agendar` | Confirmar (M-04) |
| `/c/:tenantId/agenda/compromisso/:id` | Detalhe / cancelar (TEL-06) |

Mensagem de confirmação/cancelamento: atalho «Abrir conversa» → envio manual (#33). Estados financeiros → #37+.

## Código

| Área | Path |
| --- | --- |
| Domínio | `src/clinic/scheduling/booking.ts`, `views.ts`, `allocations.ts` |
| HTTP | `src/scheduling/routes.ts` |
| DO | `confirmClinicAppointment`, `cancel…`, `reschedule…`, `queryClinicAgenda` |
| UI | `src/client/panel/screens/agenda/` |
| Testes | `booking.test.ts`, `http.test.ts` (bloco #36) |

## Em aberto / fora deste PR

- Sinal Pix e confirmação automática pós-pagamento (#37–#39)
- Lista final de motivos com a clínica piloto
- Cliente WebSocket dedicado (hoje: polling 15 s)
- Fluxo UI completo de reagendar no mesmo ecrã (hoje: cancelar no detalhe; reagendar via Agendar + API)
- Valores reais de duração/expediente do piloto
