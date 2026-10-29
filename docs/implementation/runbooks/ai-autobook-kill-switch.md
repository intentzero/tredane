# Runbook — Kill switch do botão de agendamento (`AI_AUTOBOOK`)

**Estado:** **Proposto** · S9 [#180](https://github.com/intentzero/tredane/issues/180) · H1/H10 · DEC-061  
**Âmbito:** interromper **novas** marcações/Pix iniciados pelo clique Confirmar da proposta.  
**Não** cancela automaticamente compromissos já confirmados.  
**Não** autoriza deploy nem religar o piloto — ver [seg-ia-s9-e2e-validation.md](../../security/seg-ia-s9-e2e-validation.md).

## Quando usar

- Suspeita de marcação indevida pela IA / botão.
- Incidente de abuso, webhook anómalo ou proposta mal versionada em staging/piloto.
- Ensaio sintético de recovery (CI / harness local).

## Interromper novas ações (kill switch)

1. **Remover ou alterar** a variável do Worker:
   - Tirar `AI_AUTOBOOK=on` **ou** definir `AI_AUTOBOOK=off` (qualquer valor ≠ `on` desliga).
   - Opcional: esvaziar `AI_AUTOBOOK_TENANTS` para que nenhuma clínica fique autorizada mesmo se a flag voltar a `on` por engano.
2. **Republicar** a configuração do Worker no ambiente afectado (staging/prod — só com autorização humana; este runbook não é ordem de deploy).
3. **Efeito:** o próximo job/clique lê a capacidade de novo (`capability` fail-closed). Cliques em curso **antes** do commit são negados com `capability_disabled`. Reentregas **depois** de um book já commitado devolvem o resultado existente (idempotência) — **não** criam segundo compromisso e **não** o apagam.
4. Confirmar no painel/logs técnicos (sem PII): novos `appointment.ai_booked` deixam de aparecer para eventos novos.

Referência de vars: [environments.md](../environments.md) § `AI_AUTOBOOK`.

## Eventos pendentes sem duplicação

| Situação | Acção |
| --- | --- |
| Clique Confirmar reentregue (Meta/Queue) após book | Replay idempotente (`proposal.book:<id>:v<ver>` / `proposal.pix:…`) — um efeito |
| Resultado WhatsApp `failed` / `unknown` | Manter `pending_communications`; alerta aos 5 min (H7); equipe envia aviso manual |
| Proposta `envio_incerto` / não `enviada` | Não autoriza clique; reenviar ou encaminhar à equipe |
| Job de rascunho IA ainda na fila | Com capacidade off, automações novas são negadas; rascunho assistivo pode continuar conforme opt-in da clínica (independente) |

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
| Desligar `AI_AUTOBOOK` e republicar | Cancelar automaticamente todos os `system:ai-autobook` |
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
