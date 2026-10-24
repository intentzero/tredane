# F4 — Disponibilidade por profissional e sala/equipamento

**Estado:** implementação da issue [#35](https://github.com/intentzero/tredane/issues/35) (épico [#14](https://github.com/intentzero/tredane/issues/14)). Serviço de consulta no SQLite do Clinic DO + API HTTP + UI Agendar (M-04 / TEL-05). **Sem** confirmação atómica (#36), Pix (#37+) nem cancelamento/reagendamento. Dados sintéticos apenas.

## Decisões aplicadas (Confirmado)

| DEC / REQ | Comportamento |
| --- | --- |
| DEC-008 | Duração + intervalo (buffer) ocupam **profissional e sala/equipamento**; grade 15 min; fuso por clínica; «Horário proposto» não reserva |
| DEC-014 | Serviço exige profissionais ligados + sala/equipamento (categoria ou recurso) |
| DEC-047 | «Aguardando sinal» não reserva (sem linha de compromisso até confirmar) |
| REQ-030 / AC-09 / AC-38 | Conflito em qualquer recurso exigido remove o horário; IDs de outro tenant negados |
| REQ-052 | Sem config mínima → `schedulingAllowed=false` → lista vazia |

## Algoritmo

1. Resolver profissionais activos ligados ao serviço (ou filtro «Qualquer disponível»).
2. Resolver salas/equipamentos activos que satisfazem o requisito.
3. No dia civil `YYYY-MM-DD` no fuso da clínica, gerar inícios a cada 15 min.
4. Ocupação do candidato = `durationMinutes + bufferMinutes`.
5. Exigir expediente semanal cobrindo toda a ocupação em **todos** os recursos do par.
6. Excluir sobreposição com bloqueios pontuais e compromissos `status=confirmed` (ocupação do compromisso também inclui o buffer do seu serviço).
7. Consulta é **leitura pura** (`createdReservation: false`). Revalidação via `POST …/check` para o comando de confirmar (#36).

Sem migração nova — reutiliza tabelas da migração 3 (`services`, `resources`, `weekly_windows`, `resource_blocks`, `appointments`).

## APIs

| Método | Path | Quem |
| --- | --- | --- |
| GET | `/api/tenants/:id/availability?serviceId&date&professionalId?` | `clinic.agenda.operate` |
| POST | `/api/tenants/:id/availability/check` | idem |

Resposta da lista omite indisponíveis (TEL-05). O check devolve `reasons[]` (`appointment_conflict`, `resource_block`, `outside_weekly_hours`, …).

## UI (painel)

| Path | Ecrã |
| --- | --- |
| `/c/:tenantId/agenda` | Dia (placeholder até visão completa #36) + atalho Agendar |
| `/c/:tenantId/agenda/agendar` | M-04: serviço, profissional, dia, horários livres; revalidação; refresh periódico |

## Código

| Área | Path |
| --- | --- |
| Domínio | `src/clinic/scheduling/` |
| HTTP | `src/scheduling/` |
| DO | `queryClinicAvailability`, `checkClinicSlot` |
| UI | `src/client/panel/screens/agenda/` |
| Testes | `scheduling.test.ts`, `http.test.ts`, rotas do painel |

## Em aberto / fora deste PR

- Confirmação / cancelamento / reagendamento atómicos (#36)
- Sinal Pix e estados de cobrança (#37+)
- Valores reais de duração/expediente da clínica piloto
- Cliente WebSocket dedicado (hoje: polling 15 s na tela Agendar)
- Visão dia/semana completa da agenda (TEL-04)
