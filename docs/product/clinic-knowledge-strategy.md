# Estratégia de conhecimento da clínica e avaliação de RAG

**Estado:** Proposto — discovery de produto e arquitetura; **não é ADR, decisão aprovada nem autorização para implementação.**  
**Data:** 29/10/2026  
**Repositório:** `intentzero/tredane`  
**Escopo:** conhecimento institucional por clínica para sugestões de IA no WhatsApp, com recuperação verificável e isolamento multi-tenant.

## 1. Síntese executiva

**Recomendação em avaliação:** construir primeiro uma **camada de conhecimento aprovado da clínica** com recuperação estruturada no SQLite do Durable Object da própria clínica. Considerar busca textual **FTS5** caso o volume ou as variações de perguntas justifiquem. Adiar embeddings, Vectorize e RAG vetorial até testes com a clínica piloto demonstraram ganho suficiente para compensar custo, latência, indexação e risco operacional.

O problema principal não é falta de conhecimento geral no LLM: é a ausência de um lugar explícito, controlado e auditável onde **cada clínica ensina como atende**, com regras de publicação e precedência por fonte.

**RAG é uma técnica possível de recuperação, não um requisito do produto.** Busca por IDs, texto e filtros pode cumprir a mesma função em bases pequenas. O agente deve continuar sem autoridade para decidir preço, disponibilidade, reserva ou resposta clínica por conta própria.

## 2. O que existe hoje e o que falta

### Base existente

- **DEC-011 / REQ-072:** contexto mínimo enviado ao LLM; mensagens recentes da conversa, primeiro nome, catálogo e etapa, com proibições explícitas. Há uma **divergência em aberto** sobre o contexto factual ampliado (H2), detalhada em [S8 — minimização](../security/ai-context-minimization.md). Esta proposta não resolve essa divergência nem autoriza ampliar payloads.
- **DEC-038 / ADR-0012:** dados operacionais por clínica no SQLite nativo do respectivo Durable Object; D1 central para administração.
- **DEC-046 / REQ-073–075:** preço exclusivamente cadastrado; descrição de procedimentos exclusivamente do campo aprovado **“Explicação para clientes”**; sem explicação, não descrever; dúvidas sobre saúde/contraindicações/diagnóstico encaminhadas à profissional; sugestão revisada por humano.
- **DEC-060 revista por DEC-061:** o LLM interpreta, mas só o botão de WhatsApp de proposta versionada, válida e montada pelo backend pode disparar confirmação, com revalidação e controles; não há autorização por texto livre.
- **ADR-0004:** Claude via Cloudflare AI Gateway, revisão humana das sugestões e preservação da operação manual se IA falhar.

### Lacunas de conhecimento institucional

| Categoria | Exemplos | Fonte de verdade preferida | Estado |
| --- | --- | --- | --- |
| Catálogo e preços | preço, duração, público do serviço, explicação | Cadastro estruturado de serviços | Já modelado; não duplicar |
| Operação e agenda | vagas, bloqueios, recursos, compromissos, sinal Pix | APIs/operações transacionais do domínio | Já modelado; nunca RAG |
| Políticas administrativas | atrasos, faltas, cancelamento, remarcação, condições de atendimento | Regras estruturadas quando computáveis; conteúdo aprovado para explicá-las | Parcial; validar formato |
| Orientações não clínicas aprovadas | o que levar, como chegar, instruções gerais de preparo e pós-atendimento | Conteúdo aprovado e versionado pela responsável | Lacuna candidata |
| FAQ da clínica | estacionamento, acesso, meios de pagamento, como funciona a visita | Perguntas/respostas aprovadas | Lacuna candidata |
| Dúvidas sobre saúde | medicação, gestação, contraindicação, diagnóstico, recomendação personalizada | Profissional qualificado, fora da resposta autônoma | Fora do escopo de conhecimento respondível |

Não usar respostas geradas sobre medicina estética como substituto de orientação profissional. Informações gerais de preparação também devem passar por revisão da responsável e ser bloqueadas se implicarem recomendação clínica não aprovada.

## 3. Objetivos e não objetivos

**Objetivos:**
1. Respostas corretas, rastreáveis à clínica e sem alucinações de políticas/preços.
2. Autonomia da responsável para editar/aprovar conteúdo sem criar prompts técnicos.
3. Recuperação curta e relevante, com atualização e despublicação efetivas.
4. Isolamento por clínica, aplicação da política de contexto mínimo e métricas de qualidade.
5. Possibilidade de mudar o mecanismo de busca sem alterar domínio, agente ou regras de autorização.

**Não objetivos nesta proposta:**
- Construir embeddings/Vectorize no MVP por antecipação;
- usar RAG para preço, agenda, disponibilidades, agendamento ou ações financeiras;
- indexar conversas de clientes, anexos, prontuários, dados de saúde ou conteúdo enviado pelo WhatsApp;
- permitir que a IA publique conhecimento, invente política, envie mensagens autonomamente ou confirme agendamentos;
- revisar DEC-011, autorizar dados reais, aprovar autonomia ou criar requisito novo por implicação.

## 4. Opções técnicas

| Alternativa | Vantagens | Limitações | Avaliação |
| --- | --- | --- | --- |
| Enviar todo o conhecimento ao prompt | Simples com poucos itens | Contexto, custo/tokens, conteúdo irrelevante e controle de versão | Só como baseline experimental |
| Recuperação estruturada no SQLite do DO | Baixa complexidade, isolamento nativo, filtros por tipo/serviço, consistência editorial | Menor tolerância a sinônimos e perguntas vagas | **Preferida inicialmente** |
| SQLite FTS5 no mesmo DO | Busca textual ranqueada, sem índice externo | Exige manutenção do índice e testes de idioma/termos | Evolução incremental |
| Embeddings + Cloudflare Vectorize | Similaridade semântica; melhor potencial com documentos extensos e variações lexicais | Custo/latência de embedding, sincronização, exclusão, governança cross-tenant | Avaliar mediante evidência |
| Recuperação híbrida (estruturada + FTS5 + vetores) | Maior cobertura em bases heterogêneas | Complexidade de ranking, deduplicação e testes | Posterior, se necessário |

Cloudflare documenta FTS5 como extensão suportada em SQLite-backed Durable Objects e namespaces/filtros de metadados em Vectorize. **Capacidades do provedor não significam que esta integração já esteja implementada no Tredane.**

Referências de infraestrutura:
- [SQLite-backed Durable Objects / FTS5](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Vectorize — filtragem e namespaces](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/)
- [Vectorize — preços e unidades de cobrança](https://developers.cloudflare.com/vectorize/platform/pricing/)

## 5. Arquitetura de referência proposta (não aprovada)

```text
WhatsApp -> Worker/Hono (tenant resolvido e autenticado)
         -> Clinic Durable Object
              -> classificar intenção e risco
              -> buscar fatos operacionais via domínio (catálogo, agenda, Pix)
              -> buscar conhecimento editorial publicado por tipo/serviço
              -> aplicar política de conteúdo, origem, versão e limites
         -> Context Builder (mínimo permitido por DEC-011/REQ-072)
         -> Claude via AI Gateway (rascunho assistido)
         -> validações determinísticas + fonte à atendente
         -> revisão humana / envio autorizado

Confirmação de agendamento: fluxo DEC-061, independente do LLM/RAG.
```

**Contrato lógico (ilustrativo, não API decidida):**

```ts
retrieveApprovedKnowledge({
  tenantContext,  // derivado de autenticação/roteamento, nunca do prompt
  intent,
  serviceId,
  query,
  maxItems,
}): Array<{
  entryId: string;
  version: number;
  category: string;
  serviceId?: string;
  approvedText: string;
  sourceLabel: string;
  approvedAt: string;
}>;
```

O **backend**, e não o LLM, define o tenant, aplica autorização e restringe resultados a conteúdo `published` e atual. Para dúvidas clínicas, o classificador de risco prevalece sobre qualquer recuperação e encaminha à profissional. Disponibilidade e preço vêm sempre das operações do domínio, não do índice textual.

**Precedência sugerida:** operações transacionais e catálogos autoritativos > conteúdo editorial vigente aprovado > ausência de informação e handoff. Se houver conflito, não escolher a resposta “mais plausível”; bloquear o trecho contraditório e alertar a responsável.

### Persistência editorial mínima (hipótese)

`clinic_knowledge_entries` por DO: `id`, `category`, `service_id?`, `title/question`, `approved_answer`, `status` (draft/published/archived), `version`, `created_by`, `approved_by`, `approved_at`, `updated_at`. Revisões/publicações não devem sobrescrever silenciosamente histórico necessário à auditoria (definir retenção jurídica). Buscar apenas publicadas. Separar texto de exibição ao cliente de instruções internas e de avisos à atendente.

O schema é **exemplo para discovery**, não uma migração autorizada. Reutilizar campos e regras já existentes (como “Explicação para clientes” e cancelamento de Pix) em vez de criar cópias inconsistentes. Se surgirem documentos em R2, tratá-los como originais privados, com índices derivados e política de exclusão sincronizada.

### Isolamento e expansão vetorial

A hipótese inicial conserva tudo no SQLite por clínica. Em eventual Vectorize compartilhado, filtrar obrigatoriamente por namespace/tenant **imposto pelo backend**, com isolamento e testes A/B; nomes de namespace, quotas, limites e custos exigem validação antes de escolher a topologia. Nenhum conteúdo bruto de outras clínicas deve entrar nos resultados ou no prompt.

## 6. Experiência do produto: “Conhecimento da Clínica”

Propor uma área simples na Clinic App, sob gestão da responsável, com:
- **Perguntas e respostas**: enunciado, resposta aprovada e categoria;
- **Políticas da clínica**: conteúdo explicativo onde não houver regra determinística já cadastrada;
- **Instruções por serviço**: associadas ao cadastro, sem duplicar preço/duração/explicação já existentes;
- **Estado editorial**: rascunho, publicado, arquivado; responsável, data e versão;
- **Prévia/teste**: “Como a IA responderia?” com indicação da fonte, sem enviar mensagem;
- **Falhas de cobertura**: perguntas sem resposta suficiente, agregadas e sem reter conteúdo pessoal sem autorização jurídica.

**Não assumir** que PDFs, importação de sites, editor rico ou alimentação por conversas são necessários no MVP. Validar o fluxo de preenchimento com a clínica piloto antes de definir interface e persistência.

## 7. Segurança, conformidade e controle

1. **Minimização:** o novo conteúdo institucional só poderá integrar o LLM após explicitar sua inclusão na DEC-011/REQ-072 e passar revisão jurídica; não considerar esta análise aprovação tácita do payload.
2. **Dados pessoais e saúde:** não indexar mensagens de clientes, anexos nem prontuários; conteúdo público da clínica ainda deve passar por validação, sanitização e regras de retenção.
3. **Prompt injection:** conteúdo recuperado é **dado não confiável**, nunca instrução de sistema, mesmo quando publicado; impedir comandos do tipo “ignore suas regras”. Restrições determinísticas prevalecem.
4. **Isolamento:** acesso e busca sempre por tenant resolvido no backend; testes cruzando tenants, membros multi-tenant, suporte/impersonação, cache e exclusão.
5. **Versões:** aprovação/despublicação entram em vigor sem servir texto antigo; se houver índice externo, tratar invalidação, reindexação e falha de sincronização.
6. **Saúde:** dúvidas sobre contraindicação, medicamentos, gestação, diagnóstico ou aptidão individual devem ser encaminhadas a profissionais, mesmo quando coincidirem com um trecho recuperado.
7. **Operação:** se a busca falhar ou não houver fonte suficiente, o atendimento manual deve continuar; registrar apenas métricas técnicas sem corpos sensíveis, salvo política aprovada.
8. **Envio/ações:** preservar a revisão humana e a DEC-061. A recuperação de conteúdo não autoriza enviar mensagens, remarcar, cancelar, cobrar nem agendar.
9. **Observabilidade:** avaliar fonte, versão, categoria, falha e latência; não registrar prompts nem texto do cliente em telemetry por padrão.
10. **Provedor e transferências:** alinhar IA Gateway, retenção Anthropic/Cloudflare e LGPD aos gates existentes antes de dados reais.

## 8. Plano de avaliação e critérios de avanço

Construir **benchmark sintético**, preferencialmente baseado em perguntas que atendentes realmente recebem, sem copiar conversas pessoais. Usar categorias como: preço/agenda, política, preparo geral aprovado, acesso à clínica, pergunta clínica, informação ausente, conflito documental, texto malicioso e conversa com intenção de agendar.

Comparar no mesmo conjunto:
- A: contexto mínimo/catálogo atual;
- B: recuperação estruturada por tipo e serviço;
- C: B + FTS5, se necessário;
- D: busca vetorial ou híbrida apenas se B/C não atenderem.

**Métricas sugeridas (sem limiares aprovados):**
- correção factual em relação à fonte; resposta com referência válida;
- falsos positivos (“inventou política” ou recomendação clínica), violações de isolamento e prompt injection — **zero tolerância como requisito de segurança a ser validado**;
- cobertura de perguntas respondíveis versus taxa de handoff correto quando não há fonte;
- taxa de escolha da fonte correta, desatualização após alteração e conflitos entre fontes;
- latência p50/p95 por recuperação e geração;
- custo por 1.000 perguntas, volume de tokens, storage, embeddings, reindexação e custo de manutenção;
- facilidade para responsável publicar/atualizar; qualidade percebida pela equipe.

Critérios de saída do discovery:
1. Obter amostra de políticas/FAQ/serviços de pelo menos uma clínica piloto, sem dados pessoais.
2. Identificar as perguntas recorrentes que o catálogo e os campos existentes não resolvem.
3. Comparar A/B (e C somente quando necessário) em casos sintéticos com avaliação humana.
4. Documentar limites e adequação de FTS5 ao idioma e aos padrões de consulta.
5. Medir custo e latência incremental; avaliar se D (vetores) melhora qualidade de modo relevante.
6. Propor UX mínima e modelo editorial sem duplicação de regras.
7. Resolver explicitamente a compatibilidade com DEC-011, S8, REQ-072 e gates LGPD.
8. Submeter **uma decisão posterior e explícita** sobre MVP/editorial e mecanismo de recuperação.

A quantidade de questões, limiares e janela do piloto permanecem **em aberto**; não converter estimativas em requisitos aprovados.

## 9. Fases possíveis (não autorizadas)

- **Fase A — Discovery:** mapear conhecimento faltante, prototipar texto e avaliar custo/risco; sem alteração operacional.
- **Fase B — Conhecimento estruturado:** se aprovado, fluxo editorial mínimo com recuperação no Clinic DO e evidência de fontes para sugestões.
- **Fase C — Busca textual:** FTS5 se perguntas de linguagem natural não forem suficientemente atendidas por filtros e catálogo.
- **Fase D — RAG vetorial/híbrido:** só com comparação mensurável, regras de indexação/isolamento e controle de custo.

Cada fase pós-discovery requer aceite próprio, atualização das decisões/requisitos afetados e issues de implementação separadas. **Este documento não altera o escopo do MVP.**

## 10. Custos e riscos econômicos

Sem medições e volumes reais de conteúdo, **não há estimativa confiável de custo mensal**. Uma eventual análise deve separar: armazenamento SQLite/R2, queries, tokens de contexto, geração Claude, embeddings por atualização e por pergunta, consultas Vectorize, reindexação após publicação/exclusão, operação, observabilidade e tempo de manutenção.

Um sistema vetorial pode ter preço baixo de armazenamento e ainda trazer custo relevante em integração, qualidade editorial, revisões e sincronização. Consultar [preços atuais de Vectorize](https://developers.cloudflare.com/vectorize/platform/pricing/) e preços do modelo de embeddings **na data da decisão**, não fixar valores nesta proposta.

## 11. Referências do Tredane

- [Decisões de produto (DEC-011, DEC-038, DEC-046, DEC-060/061)](decisions.md)
- [Requisitos de IA, preços e procedimentos (REQ-072–075)](requirements.md)
- [Modelo conversacional híbrido](../architecture/conversational-hybrid-model.md)
- [ADR-0004 — IA assistiva e revisão humana](../adr/0004-ai-human-in-loop.md)
- [ADR-0012 — SQLite por clínica](../adr/0012-clinic-durable-object-sqlite.md)
- [S8 — inventário e minimização de contexto](../security/ai-context-minimization.md)
- [Registro de hipóteses do piloto](validation-register.md)

---

**Resultado deste documento:** estabelecer uma hipótese fundamentada de produto e arquitetura para discovery, **sem nova DEC, sem novo ADR, sem migrações e sem habilitar mudanças operacionais**.
