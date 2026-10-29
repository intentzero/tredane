# Runbook — Pausar o botão de agendamento

**Estado:** **Confirmado (Paulo, 29/10/2026)** para o interruptor. S9 [#180](https://github.com/intentzero/tredane/issues/180) · DEC-061  
**Âmbito:** interromper **novas** propostas e marcações/Pix iniciados pelo clique Confirmar.  
**Não** cancela automaticamente compromissos já confirmados.  
As vars `AI_AUTOBOOK` e `AI_AUTOBOOK_TENANTS` foram retiradas. A capacidade está sempre ligada; a pausa é por clínica.

## Quando usar

- Suspeita de marcação indevida pela IA / botão.
- Incidente de abuso, webhook anómalo ou proposta mal versionada em staging/piloto.
- Ensaio sintético de recovery (CI / harness local).

## Interromper novas ações (kill switch)

1. A **owner** da clínica abre Clínica → **Limites das automações** e liga **Pausar novas marcações automáticas por botão**.
2. Não é preciso republicar o Worker. A pausa vale no próximo job de rascunho e no próximo clique.
3. **Efeito:** novos envios de proposta e cliques Confirmar desta clínica são negados (`capability_disabled` no clique). Reentregas **depois** de um book já commitado devolvem o resultado existente (idempotência) — **não** criam segundo compromisso e **não** o apagam.
4. Confirmar no painel/logs técnicos (sem PII): novos `appointment.ai_booked` deixam de aparecer para eventos novos desta clínica.

Referência: [environments.md](../environments.md) § proposta de horário.

## Eventos pendentes sem duplicação

| Situação | Acção |
| --- | --- |
| Clique Confirmar reentregue (Meta/Queue) após book | Replay idempotente (`proposal.book:<id>:v<ver>` / `proposal.pix:…`) — um efeito |
| Resultado WhatsApp `failed` / `unknown` | Manter `pending_communications`; alerta aos 5 min (H7); equipe envia aviso manual |
| Proposta `envio_incerto` / não `enviada` | Não autoriza clique; reenviar ou encaminhar à equipe |
| Job de rascunho IA ainda na fila | Com a pausa ligada, a proposta nova é negada; o rascunho assistivo pode continuar conforme opt-in da clínica (independente) |

Não reprocessar cegamente a mesma cobrança Pix: seguir [reprocess.md](reprocess.md) e testes #39/#40 (`paid_without_slot`, replay financeiro).

## Preservar compromissos legítimos

- **Não** correr cancelamento em massa nem «rollback» que apague `appointments` confirmados (manuais ou `system:ai-autobook` já auditados).
- Compromissos manuais (`confirmed_by` de utilizador) e os já marcados pelo botão **permanecem** até a equipe decidir caso a caso.
- «Alterar detalhes» / propostas expiradas **não** cancelam compromisso existente.

## Identificar afectados

1. No Clinic DO (SQLite da clínica): `operational_audit` com `action = 'appointment.ai_booked'` no intervalo do incidente (ids técnicos apenas).
2. Cruzar `proposalId` / `proposalVersion` / `appointmentId` / `chargeId` no detalhe da auditoria.
3. Listar `pending_communications` abertas/alertadas da clínica.
4. **Não** exportar corpos de mensagem, telefones ou nomes para tickets externos — só ids e `correlationId` ([incidents.md](incidents.md)).

## Correção humana

1. Equipe da clínica (ou suporte auditado) contacta a cliente pelos canais normais.
2. Remarcar / cancelar / ajustar Pix pelo fluxo manual do painel (REQ de agenda/Pix vigentes).
3. Se a proposta estava errada: criar nova versão (S3) ou encaminhar; nunca «forçar» texto livre a marcar.
4. Registar no ticket o `appointmentId` corrigido e o motivo.

## Rollback sem auto-cancel

| Fazer | Não fazer |
| --- | --- |
| Pausar na clínica | Cancelar automaticamente todos os `system:ai-autobook` |
| Tratar pendências de comunicação | Apagar auditoria |
| Corrigir caso a caso com a equipe | Reprocessar webhooks financeiros sem idempotência |
| Manter Pix `paid_without_slot` visível à equipe | Inventar estorno automático em massa |

## Ensaio sintético (CI)

Cobertura automatizada (dados fictícios):

- `src/seg-ia-validation/adversarial.test.ts` — capability off mid-job; replay após commit; preservação de compromisso manual.
- `src/clinic/proposals/execute-confirm.test.ts` — `capability_disabled` + replay.
- Verificador: `npm run seg-ia:evidence` (sempre `aiAutobookLiberated: false`).

Ensaio **live** em staging: **Em aberto** (exige Worker provisionado e autorização).

## Relação com outros runbooks

- Indisponibilidade geral: [unavailable.md](unavailable.md)
- Reprocessamento de filas: [reprocess.md](reprocess.md)
- Incidentes / correlação: [incidents.md](incidents.md)
- Gates de liberação: [seg-ia-s9-e2e-validation.md](../../security/seg-ia-s9-e2e-validation.md)
