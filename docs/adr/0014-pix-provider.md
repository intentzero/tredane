# ADR-0014 — Provedor de Pix para o sinal

- **Estado:** avaliação de engenharia **registrada** (24/10/2026); escolha do provedor **ainda Proposta** — aguarda decisão do responsável pelo produto. O método (avaliação na F0) permanece **Confirmado** ([DEC-047](../product/decisions.md)).
- **Origem:** [Sinal por Pix](../product/sinal.md), REQ-076 a REQ-082; issue [#17](https://github.com/intentzero/tredane/issues/17).
- **Bloqueador:** adaptador **real** e conexão M-33 em produção. O adaptador **simulado** e o contrato em `src/pix/` **não** dependem desta escolha.

## Problema

O sinal precisa de um provedor que gere cobranças Pix **na conta da própria clínica**, avise o pagamento por webhook e permita estorno, sem que o Tredane receba ou repasse dinheiro.

## Critérios da avaliação

1. A clínica recebe na própria conta, conectada pela responsável (por exemplo, por autorização de conta ou chave de API da clínica), sem o Tredane como intermediador do dinheiro.
2. Cobrança Pix com valor, prazo de expiração e identificador próprio do Tredane.
3. Webhook assinado, com reentrega e consulta de estado para reconciliar.
4. Estorno total por API, com estado consultável.
5. Ambiente de testes com pagamentos simulados.
6. Taxas por cobrança e por estorno, para a clínica, medidas e registradas.
7. Documentação, contrato e tratamento de dados compatíveis com a revisão jurídica (LGPD).
8. Funciona chamado de Cloudflare Workers (HTTP com `fetch`, sem SDK que dependa de APIs do Node indisponíveis).

## Opções avaliadas (documentação oficial, 24/10/2026)

Foram comparados **quatro** provedores com Pix no Brasil. Fontes e data constam na tabela; taxas e termos comerciais mudam — confirmar no contrato antes de produção.

| Critério | A. Mercado Pago | B. Asaas | C. Woovi (OpenPix) | D. Efí (Gerencianet) |
| --- | --- | --- | --- | --- |
| 1. Conta da clínica, sem Tredane no dinheiro | **Atende** via OAuth (Authorization Code): a responsável autoriza a app; cobranças usam o access token do vendedor; o valor fica na conta Mercado Pago da clínica. Fonte: [OAuth](https://www.mercadopago.com.br/developers/pt/docs/security/oauth) (consultado 24/10/2026). | **Atende com ressalva:** a clínica pode usar a própria conta/API Key (dinheiro na conta Asaas dela). Modelo BaaS/subcontas existe, mas acrescenta enquadramento regulatório e conta-pai — evitar se o Tredane não quiser papel de instituição. Fontes: [Cobranças Pix](https://docs.asaas.com/docs/cobrancas-via-pix), [BaaS](https://docs.asaas.com/docs/sobre-baas) (24/10/2026). | **Atende com ressalva:** App ID da conta Woovi da clínica; saldo da conta virtual é direcionado à chave Pix CNPJ da empresa. Confirmar DPA e que o Tredane não figura como recebedor. Fontes: [Charge Pix](https://developers.woovi.com/en/docs/woovi-prompts/charge-pix), [Conta virtual](https://developers.woovi.com/en/docs/faq/faq-virtual-account) (24/10/2026). | **Atende** no modelo Bacen (cobrança na conta/chave Pix da clínica). Fontes: [API Pix Efí](https://dev.efipay.com.br/docs/api-pix/webhooks/) (24/10/2026). |
| 2. Valor, expiração, id próprio | **Atende:** Payments/Orders com `external_reference` e `date_of_expiration`. Fonte: docs Checkout Transparente / Payments (24/10/2026). | **Atende parcial:** `billingType: PIX`, `dueDate`, QR com `expirationDate`; identificador externo via campos da cobrança. Expiração curta (ex.: 2 h) exige validar no sandbox se o QR respeita o prazo do sinal. Fonte: [Cobranças via Pix](https://docs.asaas.com/docs/cobrancas-via-pix) (24/10/2026). | **Atende bem:** `value` em centavos, `expiresIn` em segundos (encaixa 2 h), `correlationID` = id Tredane. Fonte: [Charge Pix](https://developers.woovi.com/en/docs/woovi-prompts/charge-pix) (24/10/2026). | **Atende:** cobrança imediata (`/v2/cob`) com `txid` e calendário de expiração Pix Bacen. |
| 3. Webhook assinado + consulta | **Atende:** `x-signature` HMAC-SHA256; reentregas; reconciliar com `GET /v1/payments/{id}`. Fonte: [Webhooks](https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks) (24/10/2026). | **Atende parcial:** header `asaas-access-token` (token compartilhado, não assinatura criptográfica do corpo); reentrega at-least-once com `id` de evento; consulta de cobrança na API. Fonte: [Webhooks](https://docs.asaas.com/docs/about-webhooks) (24/10/2026). | **Atende:** `x-webhook-signature` RSA-SHA256 + HMAC opcional; eventos `OPENPIX:CHARGE_*` e de estorno; `GET /charge/{id}`. Fonte: [Webhook public keys](https://developers.woovi.com/en/docs/webhook/seguranca/webhook-public-keys) (24/10/2026). | **Atende com custo:** webhook Pix Bacen; mTLS (ou skip-mTLS + validação própria). Consulta de cobrança/Pix recebidos. Fonte: [Webhooks Efí](https://dev.efipay.com.br/docs/api-pix/webhooks/) (24/10/2026). |
| 4. Estorno total consultável | **Atende:** `POST /v1/payments/{id}/refunds`; status inclusive `in_process` com header dedicado. Fonte: [Reembolsos Pix](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/payment-management/cancellations-and-refunds/refund-pix) (24/10/2026). | **Atende:** `POST /v3/payments/{id}/refund`; webhooks `PAYMENT_REFUNDED` / `PAYMENT_REFUND_IN_PROGRESS`; exige saldo suficiente (taxas não voltam). Fonte: [Estornar cobrança](https://docs.asaas.com/reference/estornar-cobranca) (24/10/2026). | **Atende:** `POST /charge/{correlationID}/refund` com idempotência; status `IN_PROCESSING` e webhooks de confirmação/rejeição. Fonte: [Charge refund](https://developers.woovi.com/en/docs/refund/charge-refund-create-api) (24/10/2026). | **Atende:** `PUT /v2/pix/{e2eId}/devolucao/{id}`; notificação de devolução no webhook. |
| 5. Sandbox | **Atende:** credenciais de teste + URL de webhook de teste. | **Atende:** `api-sandbox.asaas.com`; Pix e webhooks no sandbox. Fonte: [FAQ Sandbox](https://docs.asaas.com/docs/faq-sandbox) (24/10/2026). | **Atende:** `api.woovi-sandbox.com` / `app.woovi-sandbox.com` (App ID separado). Fonte: [Ambiente de teste](https://developers.woovi.com/en/docs/intro/test-environment) (24/10/2026). | **Atende:** homologação Pix Efí com certificados de sandbox. |
| 6. Taxas | **Parcial:** taxas públicas por meio de pagamento no site do MP; registrar no piloto o valor exato do contrato da clínica. Consultar tabela vigente no dashboard (24/10/2026). | **Parcial:** taxas no contrato/dashboard da conta (`Configurações > Taxas`); não há tabela única pública suficiente para fechar o MVP sem consulta comercial. | **Atende para registro:** plano percentual ~0,80% por Pix recebido (mín. R$ 0,50 / máx. R$ 5,00) ou fixo ~R$ 0,85; reembolso gratuito nos materiais públicos. Fontes: [Preços OpenPix](https://openpix.com.br/en/pricing/), [Conta virtual](https://developers.woovi.com/en/docs/faq/faq-virtual-account) (24/10/2026) — **revalidar** em `woovi.com/planos-e-precos` na decisão. | **Parcial:** taxas comerciais Efí; obter na proposta. |
| 7. LGPD / contrato | **Pendente jurídico:** DPA e papéis (operador/controlador) no dossiê. MP é terceiro conhecido; revisão obrigatória antes de dados reais. | **Pendente jurídico:** idem; BaaS pode alterar o papel do Tredane — **evitar BaaS** se quisermos só tecnologia. | **Pendente jurídico:** instituição de pagamento; confirmar que Tredane não intermedia fundos. | **Pendente jurídico:** certificado mTLS e dados Pix Bacen no dossiê. |
| 8. Cloudflare Workers (`fetch`) | **Atende:** REST HTTPS + HMAC no Worker; SDKs oficiais não são obrigatórios. | **Atende:** REST HTTPS + header de token. | **Atende:** REST HTTPS; verificação RSA com Web Crypto (`crypto.subtle`). | **Atenção:** API exige certificado cliente (mTLS) — Workers suportam binding `mtls_certificates`, com restrições; webhook tradicional pede mTLS no receptor ou skip-mTLS. Mais atrito operacional que A–C. Fontes: [mTLS Workers](https://developers.cloudflare.com/workers/runtime-apis/bindings/mtls/), [Webhooks Efí](https://dev.efipay.com.br/docs/api-pix/webhooks/) (24/10/2026). |

### Limitações transversais

- Nenhum provedor foi exercitado com credenciais reais de sandbox neste PR (sem segredos de produção/sandbox versionados). A prova HTTP usa servidor mock local + `fetch` (mesmo API surface dos Workers).
- Pagamento tardio, idempotência, cancelamento, resultado incerto e reconciliação foram modelados no **adaptador simulado** (`src/pix/`) e cobertos por testes.
- Revisão jurídica (critério 7) e taxas contratuais finais (critério 6) **bloqueiam** uso com clientes reais, não o simulador.

## Recomendação de engenharia (Proposta — não é decisão de produto)

**Preferência técnica: C. Woovi (OpenPix)**, com **A. Mercado Pago** como alternativa próxima.

| Motivo | Detalhe |
| --- | --- |
| Encaixe no sinal (2 h) | `expiresIn` em segundos e `correlationID` cobrem REQ-078/081 sem gambiarra de `dueDate` diária. |
| Webhook | Assinatura criptográfica do corpo (RSA), superior ao token estático do Asaas. |
| Workers | Só `fetch` + Web Crypto; sem mTLS obrigatório. |
| Taxas públicas | Permitem registrar ordem de grandeza para a clínica no piloto (ainda sujeitas a confirmação comercial). |
| Alternativa MP | Melhor UX de “conectar conta” (OAuth) para M-33 e adoção ampla; `date_of_expiration` + `external_reference` atendem. Preferir MP se produto priorizar OAuth/familiaridade da clínica. |
| Evitar por agora | **Asaas BaaS** (risco de parecer intermediação) e **Efí** (mTLS/operacional) como primeira escolha F0. |

**O responsável pelo produto deve escolher A ou C (ou outra opção com nova evidência).** Até lá, o estado deste ADR permanece **Proposto** para a escolha; **não** promover a Confirmado por conveniência técnica.

## Consequências

- Sem provedor escolhido, a F0 implementa a interface de cobrança atrás de um adaptador e um provedor **simulado** para testes (`src/pix/`, `SimulatedPixAdapter`).
- Trocar de provedor depois afeta só o adaptador real e a conexão de conta (M-33).
- Adaptador real, credenciais de sandbox do provedor escolhido e revisão jurídica ficam para issues posteriores (ex.: #37), após DEC explícita.
