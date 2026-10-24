# Liberações Meta, privacidade e condições do piloto

**Estado:** **Proposto** (24/10/2026). Registro operacional da issue [#18](https://github.com/intentzero/tredane/issues/18) (épico [#14](https://github.com/intentzero/tredane/issues/14)). **Não é decisão de produto nem parecer jurídico.** Consolida pré-condições, responsáveis funcionais, evidências e gates antes de dados reais ou números reais de WhatsApp.

**Escopo desta entrega:** checklists, rascunhos e rastreio de liberações externas. **Fora:** implementação de produto WhatsApp (F3), integração Pix (F0/#17) e features de domínio.

**Regras do registro**

1. Cada bloqueador tem **responsável funcional**, **evidência**, **estado** e **gate**.
2. Não registrar preço, permissão, custo ou aprovação externa sem confirmação documentada (DEC-043).
3. Credenciais de teste e contratos de integração podem ser usados na engenharia enquanto liberações reais estão pendentes.
4. Pendência impeditiva mantém o **go-live bloqueado**; dados sintéticos até lá.
5. Qualquer caminho que altere DEC-009 (Tech Provider + Embedded Signup) exige **decisão própria**, não atalho neste registro.

## 1. Papéis e responsáveis

Atribuição **nominal** continua **Em aberto** (issue #18). Enquanto isso, usar o papel funcional:

| Papel funcional | Escopo | Exemplos de entrega |
| --- | --- | --- |
| Produto | Prioridade do piloto, textos ao utilizador, critérios de avaliação, condições comerciais do piloto | Condições do piloto; aprovação de rascunhos de modelos; Q-UX |
| Clínica piloto | Dados de configuração autorizados ou sintéticos, aparelhos, política local de cancelamento/sinal | Serviços, jornadas, aparelhos (Q-UX-01), política de cancelamento do sinal |
| Engenharia | Meta Tech Provider (app, revisão, ambiente de teste), AI Gateway, Clerk técnico, evidências de configuração | Números/testes Meta; gateway sem payload; checklist Clerk |
| Revisão jurídica | Política de dados, termos, terceiros, sinal Pix (fiscal/contratual), transferências | Parecer sobre [dossiê](legal-review-brief.md); política de privacidade |
| Responsável pelo produto (decisor) | Fechar DEC, aceitar go-live, designar nominais | Aprovação documentada antes de dados reais |

## 2. Matriz de bloqueadores (GATE)

Estados permitidos: **Pendente** · **Em andamento** · **Evidência anexada** · **Aprovado** · **Bloqueado externo**. Não marcar **Aprovado** sem data e referência de evidência.

| ID | Bloqueador | Responsável funcional | Estado | Gate | Evidência |
| --- | --- | --- | --- | --- | --- |
| GATE-01 | CNPJ / verificação do negócio Meta (VAL-13) | Produto | **Bloqueado externo** | Mensagens reais; onboarding de clínica real | — (sem CNPJ em 24/10/2026) |
| GATE-02 | App Meta + App Review (permissões WhatsApp) | Engenharia + Produto | **Pendente** | Onboarding Embedded Signup em produção | — |
| GATE-03 | Política de privacidade publicada | Produto + Jurídico | **Pendente** | Publicação da landing; go-live; App Meta | Depende do [dossiê](legal-review-brief.md) |
| GATE-04 | Parecer LGPD (base legal, sensível, transferência) | Jurídico + Produto | **Pendente** | Dados reais; IA com conteúdo real | [legal-review-brief.md](legal-review-brief.md) |
| GATE-05 | Clerk: plano, limites, custo, DPA, região (DEC-043) | Engenharia + Produto + Jurídico | **Pendente** | Go-live com clínica real (não bloqueia F0) | Conferir docs Clerk; **não inventar valores** |
| GATE-06 | AI Gateway sem conteúdo em logs + não retenção Anthropic (DEC-011) | Engenharia + Jurídico | **Pendente** | IA com dados reais | Config + contrato; ver §4 |
| GATE-07 | E-mail transacional: provedor, DPA, região | Engenharia + Produto + Jurídico | **Pendente** | Convites e avisos de suporte em produção | Provedor ainda **Em aberto** |
| GATE-08 | Pix: DPA, papel do Tredane e taxas contratuais (DEC-047, DEC-049, ADR-0014) | Engenharia + Produto + Jurídico | **Pendente** (provedor Confirmado: Woovi; faltam DPA/taxas) | Sinal com clientes reais | [sinal.md](sinal.md); [ADR-0014](../adr/0014-pix-provider.md) |
| GATE-09 | Cloudflare: DPA e regiões (Workers, DO, D1, R2) | Engenharia + Jurídico | **Pendente** | Go-live | — |
| GATE-10 | Modelos WhatsApp aprovados (retomada, confirmação, cobrança Pix) | Produto + Engenharia | **Pendente** | Envio fora da janela de 24 h | Rascunhos em [whatsapp-templates-draft.md](whatsapp-templates-draft.md) |
| GATE-11 | Termos / política de cancelamento / requisitos fiscais do sinal | Jurídico + Clínica + Produto | **Pendente** | Sinal com clientes reais | Perguntas 10 do dossiê; política da clínica |
| GATE-12 | Configuração do piloto (serviços, recursos, aparelhos, anexos/logs) | Produto + Clínica | **Pendente** | Aceite de usabilidade e F6 | Checklist §5 (sintético até autorização) |
| GATE-13 | Critérios de avaliação do piloto e consentimentos | Produto + Clínica | **Pendente** | Liberação F6 / issue #45 | §6; matriz E2E sintética em [evidence-matrix.md](evidence-matrix.md) — activação ainda **Em aberto** |

**Referências de decisão:** DEC-009, DEC-011, DEC-043, DEC-047; VAL-01–13; Q-UX-01/05/06.

## 3. Meta — requisitos vigentes e VAL-13

**Confirmado (DEC-009):** Tredane como Tech Provider; owner conecta pelo Embedded Signup oficial; conta e número da clínica; apoio Tredane no piloto.

**Conferência da documentação oficial (24/10/2026) — Proposto como leitura de engenharia, não como conclusão de liberação:**

| Passo | Situação | Nota |
| --- | --- | --- |
| Portfólio empresarial Meta + **Business Verification** | **Bloqueado** | Continua exigido para aceder a dados de outros negócios. Exige documentos da empresa; **Tredane sem CNPJ** (VAL-13). |
| App com ícone, política de privacidade, categoria | **Pendente** | Política depende de GATE-03/04. |
| App Review com vídeos (envio de mensagem e criação de modelo) | **Pendente** | Permissões avançadas (`whatsapp_business_messaging`, e `whatsapp_business_management` se gerir modelos/definições). |
| Autenticação em dois fatores no portfólio | **Pendente** | Manter na checklist técnica. |
| Access Verification (formulário separado) | **Atualização 09/10/2026** | Meta anunciou a **retirada** deste passo para apps Tech Provider ([anúncio](https://developers.facebook.com/blog/post/2026/10/09/retiring-access-verification-for-tech-provider-apps/)). **Business Verification e App Review permanecem.** Atualizar VAL-13; não tratar Access Verification como gate ativo. |
| Embedded Signup | **Atenção** | Docs Meta: migrar para v4; v2/v3 com depreciação anunciada (conferir data vigente na doc oficial antes de implementar F3). |
| Cobrança | **Atenção** | Como Tech Provider, a clínica onboarded precisa de método de pagamento na conta de Messaging antes de enviar. |

**Números e credenciais de teste:** manter até GATE-01/02 liberados. Engenharia pode integrar webhooks e outbox com ambiente de teste Meta **sem** clínica real.

**Alternativas (Solution Partner, só número de teste sem clínica real, etc.):** **Em aberto**. Qualquer opção que mude DEC-009 exige DEC própria do responsável pelo produto.

Fontes a reconsultar antes de F3 (não fixar prints como verdade permanente):

- [Embedded Signup](https://developers.facebook.com/docs/whatsapp/embedded-signup/)
- [Retiring Access Verification](https://developers.facebook.com/blog/post/2026/10/09/retiring-access-verification-for-tech-provider-apps/)

## 4. Terceiros — dossiê de conferência

Preencher só com evidência datada. Células vazias = não verificado.

### 4.1 Clerk (DEC-043)

| Item | Estado | Evidência / data | Notas |
| --- | --- | --- | --- |
| Plano usado no piloto | Pendente | — | Menor custo **como intenção** (DEC-043); conferir nome oficial do plano na doc Clerk |
| Limites (MAU/sessões) | Pendente | — | Não inventar números |
| Custo por utilizador ativo | Pendente | — | Idem |
| DPA | Pendente | — | Levar ao jurídico |
| Região de hospedagem | Pendente | — | Idem |
| Dados no Clerk | **Confirmado** (DEC-043) | decisions.md | Só identidade mínima (nome, e-mail, sessão); sem atendimento |

### 4.2 Cloudflare AI Gateway + Anthropic (DEC-011)

| Item | Estado | Evidência / data | Notas |
| --- | --- | --- | --- |
| Gateway com logging de **payload** desligado (ou `cf-aig-collect-log-payload: false`) | Pendente | — | Doc: [Logging](https://developers.cloudflare.com/ai-gateway/observability/logging/); default guarda prompt/resposta |
| Métricas (tokens, custo, latência) sem conteúdo | Pendente | — | Permitido e desejável |
| Contrato / confirmação de não retenção Anthropic | Pendente | — | Gate de dados reais |
| Zero Data Retention (Unified Billing) | Em aberto | — | ZDR **não** substitui desligar logging do Gateway; só aplica a credenciais geridas pela CF em Unified Billing |

### 4.3 E-mail, Pix, armazenamento

| Terceiro | O que recebe | Estado | Evidência / data |
| --- | --- | --- | --- |
| Provedor de e-mail | Convites, avisos de suporte (sem PHI) | Provedor **Em aberto** | — |
| Provedor Pix — Woovi / OpenPix (ADR-0014, DEC-049) | Cobrança na conta da clínica; estados; dados de estorno | Escolha **Confirmado**; DPA/taxas contratuais **Pendente** | DEC-049 · 24/10/2026 |
| Cloudflare (Workers, DO/SQLite, D1, R2, Queues) | Hospedagem e dados do produto | DPA/região Pendente | — |
| Meta | Mensagens e número da clínica | Ver §3 | — |

Detalhe jurídico: [legal-review-brief.md](legal-review-brief.md) §3.

## 5. Configuração e condições do piloto

### 5.1 Dados permitidos agora

**Confirmado pelo recorte do MVP:** apenas dados **sintéticos** ou explicitamente autorizados sem pacientes reais, até GATE-04/12. Exemplos fictícios apenas (sem dados reais de pacientes ou clínicas).

### 5.2 Checklist de recolha (clínica / produto)

| Item | Estado | Onde registar resultado |
| --- | --- | --- |
| Serviços, durações, buffers, preços (DEC-008) | Pendente | Seed sintético até clínica autorizar |
| Profissionais, salas/equipamentos, expediente, bloqueios | Pendente | Idem |
| Política escrita de cancelamento do sinal (DEC-047) | Pendente | Texto da clínica + revisão jurídica (GATE-11) |
| Política de anexos (envio pela equipe; tipos; retenção) | **Em aberto** (DEC-011) | Issue de domínio Inbox/anexos |
| Política de logs técnicos (retenção, acesso) | **Em aberto** (REQ-070) | Dossiê + engenharia; scrub/correlação em [f6-ops.md](../implementation/f6-ops.md) (#44) |
| Aparelhos / SO / navegadores da recepção (Q-UX-01) | Pendente | Antes do aceite de usabilidade |
| Preferências push padrão e horário de silêncio (Q-UX-05) | **Em aberto** | Issue de domínio PWA/notificações |
| Reabertura de conversa vs nova; ciclo de oportunidade (VAL-02, states.md) | **Em aberto** | Issues de domínio pipeline/Inbox — **não fechar aqui** |
| Critérios de avaliação do piloto (qualidade IA, faltas, tempo até agendar, etc.) | Pendente | §6 |

### 5.3 Condições comerciais / publicação

Itens da [landing](landing.md) que bloqueiam publicação (domínio, e-mail, privacidade, preço do piloto): permanecem **Em aberto** no responsável pelo produto. Este registro não os aprova.

## 6. Critérios de avaliação do piloto (proposta)

**Proposto** — validar com produto + clínica (GATE-13). Harness sintético da [#45](https://github.com/intentzero/tredane/issues/45): [f6-e2e-validation.md](../implementation/f6-e2e-validation.md) / [evidence-matrix.md](evidence-matrix.md). **NO-GO** até autorização explícita — **não** reivindica piloto activado.

1. Fluxo completo com dados sintéticos: mensagem → resposta humana → etapa → agendamento (e sinal, se ligado). **Confirmado (CI sintético)** em `src/mvp-validation/`.
2. Nenhuma mensagem da IA enviada sem ação humana. **Confirmado (sintético)** (#41 + journey E2E).
3. Isolamento: duas clínicas de teste sem vazamento. **Confirmado (sintético)**.
4. Fora da janela de 24 h: só modelos aprovados (quando GATE-10 liberar). **Em aberto**.
5. Logs de diagnóstico sem tokens nem conteúdo pessoal desnecessário (REQ-070). **Confirmado (sintético)** (#44); retenção/ACL **Em aberto**.
6. Lista explícita do que falta para dados reais (GATE-01 a GATE-13). Ver checklist humano em f6-e2e-validation.md.

## 7. Lacunas a registar nas issues de domínio

Estas perguntas **não** são resolvidas por #18; devem aparecer nas issues de Inbox, pipeline, PWA e anexos:

| Lacuna | Referência | Gate aproximado |
| --- | --- | --- |
| Nova conversa vs reabertura; motivo de encerramento | states.md, VAL-01/02 | Schema/transições (#29/#30) |
| Oportunidade por conversa/serviço/ciclo; salto de etapas; “Concluído” / “Perdido” | states.md, VAL-02 | Pipeline |
| Envio de anexos pela equipe; tipos permitidos | DEC-011, ux-ui.md | Inbox |
| Padrões e silêncio de push (Q-UX-05) | DEC-040, M-14 | PWA |
| Textos finais Embedded Signup | DEC-009 | F3 após Tech Provider |

## 8. Critério de aceite desta issue (#18)

- [x] Registro de evidências e papéis aberto (este documento).
- [x] Requisitos Meta conferidos na doc oficial na data indicada; VAL-13 atualizado quanto a Access Verification; números de teste até liberação.
- [x] Checklists Clerk / AI Gateway / e-mail / Pix / armazenamento no dossiê de terceiros, sem preços inventados.
- [x] Rascunhos de modelos (retomada, confirmação, cobrança Pix) e apontadores a termos/cancelamento/fiscal.
- [x] Checklist de configuração sintética do piloto; lacunas de reabertura/ciclo/push encaminhadas às issues de domínio.
- [ ] **Humano/externo:** nominais, CNPJ, parecer jurídico, aprovações Meta, DPAs e dados autorizados da clínica — **go-live continua bloqueado**.

## 9. Relação com outras issues

| Issue | Relação |
| --- | --- |
| #14 | Épico de implementação; este trabalho é transversal P0 |
| #15/#16/#17 | F0 paralelo; não depende deste registro para código |
| #31–#34 (WhatsApp/F3) | Consomem GATE-01/02/10; não implementam liberações aqui |
| #45 (F6) | Consome GATE-12/13 e aprovações documentadas |

Ao preencher uma evidência: data (ISO), link ou caminho no repositório privado de evidências, quem verificou. Não colar segredos neste repositório.
