# F2 — Configuração da clínica, serviços, profissionais e recursos

**Estado:** implementação da issue [#28](https://github.com/intentzero/tredane/issues/28) (épico [#14](https://github.com/intentzero/tredane/issues/14)). API/SQLite no Clinic DO + telas owner-only no painel (M-15/16/17/20/21/22). **Sem** Acompanhamento (#30), WhatsApp Embedded Signup nem campos de sinal Pix (entregas próprias). Inbox: ver [f2-inbox.md](f2-inbox.md) (#29). Dados sintéticos apenas.

## Decisões aplicadas (Confirmado)

| DEC / REQ | Comportamento |
| --- | --- |
| DEC-042 | Só owner escreve config (`clinic.config.write`); attendant lê via `clinic.context.read` |
| DEC-008 | Duração/intervalo/expediente em múltiplos de 15 min; fuso padrão `America/Sao_Paulo`; bloqueios pontuais com motivo |
| DEC-014 | Serviço liga profissionais e sala/equipamento (categoria ou recurso) |
| DEC-046 / REQ-075 | Campo opcional «Explicação para clientes» no serviço |
| REQ-052 / AC-14 / AC-38 | Config incompleta → `schedulingAllowed=false`; inactivar mantém histórico |

## Schema SQLite (migração 3)

Tabelas: `clinic_settings`, `services`, `resources`, `service_professionals`, `service_room_requirements`, `weekly_windows`, `resource_blocks`, `appointments` (mínimo para impacto de bloqueio).

`CLINIC_SCHEMA_VERSION = 3`.

## APIs

| Método | Path | Quem |
| --- | --- | --- |
| GET | `/api/tenants/:id/config` | owner + attendant |
| GET | `/api/tenants/:id/config/readiness` | owner + attendant |
| PATCH | `/api/tenants/:id/config/settings` | owner |
| POST/PUT/PATCH | `.../config/services…` | owner |
| POST/PUT/PATCH | `.../config/resources…` | owner |
| PUT | `.../config/resources/:id/weekly` | owner |
| POST/DELETE | `.../config/blocks…` | owner |

Bloqueio com `dryRun: true` só lista compromissos afectados; create grava o bloqueio **sem** cancelar compromissos.

## UI (painel)

| Path | Ecrã |
| --- | --- |
| `/c/:tenantId/clinica` | Hub M-15 |
| `.../clinica/servicos` · `.../servicos/:id` | Lista + formulário M-16 |
| `.../clinica/recursos` · profissional/sala | M-20/21/22 |
| `.../clinica/horarios` | M-17 |

Aba Clínica continua owner-only (#22). Falha de save mantém o formulário.

## Código

| Área | Path |
| --- | --- |
| Domínio | `src/clinic/config/` |
| HTTP | `src/clinic-config/` |
| DO | métodos `*Clinic*` em `src/worker/clinic-do.ts` |
| UI | `src/client/panel/screens/clinic/` |
| Testes | `src/clinic/config/config.test.ts`, `src/clinic-config/http.test.ts` |

## Em aberto / fora deste PR

- Valores reais do catálogo/expedientes da clínica piloto
- WhatsApp Embedded Signup e «pronta para atender» completa — ver [f3-whatsapp-connection.md](f3-whatsapp-connection.md) (#31)
- Campos de sinal Pix no serviço + M-33 — ver [f4-pix-account.md](f4-pix-account.md) (#37)
- UI de Equipe na hub (API equipe #25)
- Disponibilidade (#35) — ver [f4-availability.md](f4-availability.md); confirmação atómica (#36)
- Contatos/Inbox (#29 / [f2-inbox.md](f2-inbox.md)) e Acompanhamento (#30 / [f2-pipeline.md](f2-pipeline.md))
