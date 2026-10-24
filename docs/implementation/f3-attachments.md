# F3 — Anexos privados R2 e autorização (#34)

**Estado:** implementação da issue [#34](https://github.com/intentzero/tredane/issues/34) (épico [#14](https://github.com/intentzero/tredane/issues/14)). Depende de [#32](https://github.com/intentzero/tredane/issues/32) / [#33](https://github.com/intentzero/tredane/issues/33). Dados sintéticos / `META_MODE=synthetic` até gates [#18](https://github.com/intentzero/tredane/issues/18). **Sem** F4 agenda/Pix.

## Decisões aplicadas

| ID | Comportamento |
| --- | --- |
| DEC-038 | Blobs em R2 privado; metadados no SQLite do DO (`attachments`) |
| DEC-011 / REQ-072 | Anexos **nunca** entram no contexto IA (`includedInAiContext: false`) |
| REQ-001 / AC-01 | ID/chave/URL de A não concede leitura a B; membership vigente obrigatória |
| REQ-071 | Exclusão de contacto/tenant apaga anexos (prefixo R2); soft-delete rastreável entretanto |
| ADR-0012 | Sem I/O R2 dentro de `transactionSync` |

## Política piloto (formalização)

| Item | Estado | Valor |
| --- | --- | --- |
| Tipos MIME | **Proposto** | `image/jpeg\|png\|webp`, `application/pdf`, `audio/ogg\|mpeg\|mp4` |
| Limites | **Proposto** | imagem 5 MiB; PDF 10 MiB; áudio 16 MiB |
| Bloqueados | **Proposto** | HTML/SVG/JS/ZIP/executáveis |
| Envio pela equipa (UI) | **Em aberto** (DEC-011 / ux-ui) | API de upload existe; compositor sem botão de anexo |
| Prontuário / imagem clínica | **Fora do MVP** | — |
| Retenção enquanto cliente + exclusão contacto/tenant ≤30d | **Confirmado** (DEC-011) | — |
| Validade do token efémero | **Proposto** | 15 minutos, renovável com auth vigente |
| Limpeza de órfãos `pending` | **Proposto** | 24 h → failed + delete R2 |
| Política fina de conservação / logs / Meta | **Em aberto** (VAL-09) | `RETENTION.detailedRetentionPolicy = em_aberto` |

Fixtures sintéticas (`SYNTHETIC_MEDIA_FIXTURES` / media_id com marcadores) até Meta live.

## Fluxo inbound

```text
Webhook Meta (#32)
  → parse kind=media (image|document|audio) + media_id
  → Queue INBOUND_EVENTS
Consumer
  → DO createPendingAttachment (TX metadados)
  → Graph/synthetic download + validate + R2 put (fora TX)
  → DO markAttachmentReady | markAttachmentFailed
  → DO ingestMessage + linkAttachmentToMessage
```

Tipos fora do piloto (ex. sticker/vídeo) continuam `unsupported` com corpo explícito.

## APIs

| Método | Path | Auth | Notas |
| --- | --- | --- | --- |
| GET | `/api/tenants/:id/attachments/:attId` | inbox.read | Metadados (sem r2_key) |
| GET | `…/attachments/:attId/content` | inbox.read | Stream R2; `Content-Disposition: attachment` |
| POST | `…/attachments/:attId/download-token` | inbox.read | Token HMAC efémero |
| GET | `…/attachments/:attId/content-token?token=` | token | Sem Clerk; tenant+id no path têm de bater |
| POST | `…/inbox/conversations/:cid/attachments` | inbox.reply | Upload humano; recusa `sourceUrl` |
| GET | `…/inbox/conversations/:cid/attachments` | inbox.read | Lista |
| POST | `…/attachments/cleanup-orphans` | config.write | Soft-delete + delete R2 |

Namespace R2: `tenants/{tenantId}/attachments/{attachmentId}`. Bucket não público; credenciais ausentes do cliente/logs.

## Schema (Clinic DO v8)

Tabela `attachments`: status `pending|ready|unavailable|failed`; `source`; `provider_media_id`; `r2_key`; soft-delete `deleted_at`.

D1: migração `0010` acrescenta kind `media` nos recibos de webhook.

## Testes

- `src/attachments/attachments.test.ts` — validação, isolamento cross-tenant, revogação, ingestão sintética, IA flag
- Webhook parse actualizado (image → media; sticker → unsupported)

## Em aberto / fora deste PR

- Política de retenção detalhada além de DEC-011 (**Em aberto**)
- Live Graph media + secrets (#18)
- UI de envio de anexo pela equipa (**Em aberto**)
- ~~Exclusão física em cascata no fluxo de exclusão de contacto~~ → [#43](f6-retention-purge.md)
- F4 agenda / Pix
