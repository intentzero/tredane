# Segurança da evolução autónoma — modelo de ameaças e gates

**Data:** 31/10/2026. **Estado:** análise de arquitetura concluída para revisão; controles e testes abaixo **Propostos**, sem execução nem eficácia demonstrada. **Confirmado:** DEC-084 aprova autonomia dentro de política prévia, com controlador independente. Origem desta análise: Paulo, «vamos» após pedir controles de segurança do sistema evolutivo. A análise não constitui auditoria de código, pentest, certificação ou autorização de ativação.

**Escopo:** [arquitetura evolutiva](../architecture/avaliacao-continua-conversacional.md), desde coleta de sinais até promoção, reversão e resposta a incidente. Referências do produto: [decisões](../product/decisions.md), [minimização](ai-context-minimization.md), [prompt injection](prompt-injection.md), [AIMS](aims.md), [registo](aims-register.md) e [gates do piloto](../product/pilot-gates.md). A issue #1 encerrou a definição documental do MVP; não comprova os controles desta capacidade nova.

## Resultado da análise

**Proposto — conclusão para ativação:** NO-GO enquanto não houver política operacional aprovada e evidência dos gates EA-G01–06. O risco central é converter conteúdo não confiável ou uma avaliação manipulada em autoridade de implantação. A confirmação por botão da DEC-061 e a pausa/handoff da DEC-083 continuam invariantes do atendimento; a DEC-084 não permite que o otimizador as remova.

Os cenários abaixo são ameaças plausíveis do desenho, não vulnerabilidades comprovadas no código. Severidade indica impacto potencial: **Crítica** = acesso entre clínicas, exposição de segredos, autoridade de implantação ou efeito indevido em agenda/Pix; **Alta** = degradação relevante, gasto, perda de evidência ou privacidade. Probabilidade e risco residual permanecem **Em aberto** até implementação e testes. Nenhum risco é aceito apenas por ter um controle escrito.

## Ativos, atores e fronteiras

Ativos protegidos: dados de clientes e clínicas; agenda e pagamentos; acesso humano; credenciais; orçamento; política de autorização; conjuntos de teste; rótulos e resultados; artefatos; histórico de auditoria; versão operacional estável.

Ameaçadores considerados: remetente externo, pessoa que escreve catálogo ou feedback, tenant malicioso, identidade interna comprometida, dependência/fornecedor comprometido e o próprio modelo seguindo instruções adversariais. Falhas acidentais, indisponibilidade e corridas assíncronas também entram. Superadmin não ganha leitura irrestrita de conteúdo clínico por participar da evolução.

```mermaid
flowchart LR
  U["Mensagens, catálogo, feedback: não confiáveis"] --> O["Operação por tenant e eventos canônicos"]
  O --> M["Métricas com proveniência"]
  M --> G["Otimizador e laboratório isolado"]
  G --> A["Artefato candidato imutável"]
  A --> V["Avaliador e testes protegidos"]
  V --> C["Controlador determinístico"]
  P["Política aprovada por Paulo"] --> C
  C --> D["Executor limitado: canário e promoção"]
  D --> O
  K["Revogação e contenção independentes"] --> D
```

Cada seta cruza uma fronteira de confiança. O fato de o dado vir de um Worker interno, de um relatório ou de outro agente não o torna autorização. Hashes vinculam conteúdo, mas não provam a identidade de quem o produziu: autenticação e proveniência são controles separados.

## Identidades e permissões propostas

| Componente | Pode | Não pode |
| --- | --- | --- |
| Coletor/agregador | Ler eventos mínimos do tenant autorizado e escrever projeções | Modificar eventos canônicos, executar atendimento ou ler transcrições de outros tenants |
| Otimizador | Ler dados permitidos e resultados resumidos; escrever candidatos em área de quarentena | Escrever política, oráculo de testes, resultados assinados, release ativo ou segredos |
| Laboratório | Executar candidato com dados sintéticos e dependências fixadas | Acessar rede por padrão, credenciais de produção, Meta/Pix ou o filesystem do controlador |
| Avaliador | Ler candidato imutável e corpus protegido; produzir atestado autenticado | Promover versão, alterar política ou aceitar do candidato uma nota como evidência |
| Controlador | Verificar política, escopo, custo, identidade, hash e resultados; autorizar operação específica | Executar texto/shell produzido por modelo ou aumentar os próprios limites |
| Executor | Ativar artefato exato no tenant/ambiente autorizado; reverter | API genérica de shell/SQL, migrar schema ou alterar identidades/permissões |
| Operador de incidente | Revogar autonomia, conter e auditar conforme papel específico | Reativar automaticamente política comprometida ou apagar trilha |

**Proposto:** identidades de serviço distintas e credenciais mínimas; separar bindings de escrita, buckets/prefixos e APIs. Compartilhar credencial administrativa entre otimizador e controlador invalida a independência. Sessões humanas seguem a autenticação/autorização do produto; autorização para editar política exige permissão específica, auditoria e proteção contra CSRF/replay. Gestão e rotação de chaves, executor escolhido e responsável nominal são **Em aberto** antes do EA-G01.

## Registro de ameaças, controles e testes

Todos os testes EA-T abaixo estão **Pendentes**, com dados fictícios. A coluna de evidência descreve o resultado exigido, não um resultado observado.

| ID / severidade | Cenário e impacto | Controle proposto | Teste e evidência exigida |
| --- | --- | --- | --- |
| EA-R01 / Crítica | Mensagem, catálogo ou relatório ordena ao otimizador liberar um candidato ou revelar dados | Dados delimitados; saída em schema fechado; ferramentas mínimas; autorização no executor | EA-T01: injetar ordens diretas/indiretas e falso relatório; zero ativação/segredo exposto; tentativa auditada |
| EA-R02 / Crítica | Otimizador modifica política, limite ou seu próprio avaliador | ACLs independentes; controles protegidos fora da superfície mutável; política autenticada e versionada | EA-T02: usar identidade real do otimizador para escrever políticas/testes/credenciais; todas as operações recusadas, incluindo acesso direto ao storage |
| EA-R03 / Crítica | Artefato trocado após avaliação; relatório de outro candidato reaproveitado | Manifesto imutável; atestado vincula hash, código, corpus, critérios, modelo, tenant/ambiente e política; executor confere o mesmo pacote | EA-T03: trocar bytes, manifesto, tag de imagem e relatório entre candidatos; nenhuma promoção; hash efetivamente carregado corresponde ao avaliado |
| EA-R04 / Crítica | Política revogada após aprovação; Workflow antigo ou replay ainda promove | Revalidação no efeito; epoch de revogação; transição atômica/CAS; nonce de uso único; idempotência | EA-T04: revogar durante espera e entre validação/commit; concorrência e replay não ativam versão revogada nem duplicam efeitos |
| EA-R05 / Crítica | IDs de outra clínica em API, Queue, R2, cache, Workflow ou evento WS | Tenant derivado de identidade confiável; relações revalidadas em cada superfície; namespaces e chaves por tenant | EA-T05: clínicas A/B, membership revogado e sessão de suporte expirada; negar leitura, escrita e evento cruzado em todas as superfícies |
| EA-R06 / Alta | Cliente/tenant fabrica conversões, feedback ou reclamações para orientar mudanças | Conversão vem do domínio transacional; distinguir fato/rótulo; denominadores fixos; detectar concentração e duplicação; quarentena de métricas suspeitas | EA-T06: feedback falso, webhook repetido, spam coordenado e remoção de casos difíceis; taxas canônicas não se alteram indevidamente; promoção suspensa quando evidência perde confiança |
| EA-R07 / Alta | Candidato engana juiz LLM ou aprende o corpus oculto | Oráculos determinísticos; corpus inacessível ao gerador; limites de consultas; revisão humana amostral; rotação de casos | EA-T07: falso pedido de nota máxima, respostas decoradas e falha em segmento raro; invariantes recusam candidato; relatório inclui negativos e limites da avaliação |
| EA-R08 / Crítica | Patch/dependência executa comandos, exfiltra ou altera pipeline | Sandbox efêmero sem segredos, egress negado por padrão, limites de recursos, dependências fixadas/verificadas; configuração não aceita código executável | EA-T08: leitura de credenciais, chamada a endpoint externo, instalação maliciosa, escrita fora do workspace; tentativas bloqueadas e ambiente descartado |
| EA-R09 / Alta | Loop, retry, concorrência ou resposta longa esgota orçamento | Reserva atômica por tenant e global; limite de tokens/tempo/tentativas; consumo incerto permanece reservado; cota de avaliação separada | EA-T09: chamadas concorrentes e timeout após aceite do provedor; nenhuma execução sem reserva; reconciliação não libera gasto incerto para duplicação |
| EA-R10 / Crítica | Candidato aumenta conversão removendo botão, inventando preço ou bloqueando pessoa | Regras de agenda/Pix/handoff no backend, fora da configuração mutável; testes negativos de invariantes | EA-T10: texto livre, botão expirado, proposta alterada, Pix sem vaga, pedido humano e catálogo sem preço; zero efeito indevido, pessoa continua acessível |
| EA-R11 / Alta | Log/corpus guarda conteúdo sensível; replay recria contato excluído | Minimização, retenção por classe, tombstones e cancelamento de jobs; acesso restrito; política de backup/restore | EA-T11: apagar contato durante avaliação e restaurar snapshot; dados vinculáveis não ressurgem, resultados afetados invalidados e jobs não exportam conteúdo |
| EA-R12 / Crítica | Controlador/executor comprometido ou operador abusa da autoridade | Executor revalida escopo e atestado; identidade de deployment limitada; políticas protegidas; auditoria em destino fora do alcance do otimizador; revogação operacional independente | EA-T12: permissão de controlador revogada, autorização forjada e tentativa de ampliar tenant/ambiente; negar efeitos; exercitar rotação e contenção. Compromisso simultâneo da raiz de confiança é risco residual |
| EA-R13 / Alta | Telemetria falha e canário ruim se expande; rollback volta a versão vulnerável | Heartbeat/frescor de dados, expansão bloqueada sem observação; piso de segurança e lista de versões revogadas; modo humano se não houver versão segura | EA-T13: perder métricas/controle e marcar versão anterior como insegura; nenhuma expansão nem rollback para versão proibida; alerta e atendimento humano disponíveis |
| EA-R14 / Alta | Reversão parcial deixa jobs/propostas incompatíveis ou repete cobrança | Versões nos jobs, invalidação por epoch, compatibilidade de propostas e migração fora da primeira política; preservar efeitos já confirmados | EA-T14: reverter durante envio, clique e conciliação Pix; idempotência preservada; job antigo bloqueado; compromisso existente não apagado |
| EA-R15 / Alta | Modelo/provedor muda sem mudança de pacote ou fallback amplia dados | Modelo/versionamento registrados; fallback só na lista autorizada; requalificar mudança detectada; falhar fechado para promoção | EA-T15: trocar modelo, endpoint e configuração de logging; implantação recusada ou experimento suspenso; evidência identifica configuração efetiva |

**Risco residual:** testes finitos não demonstram ausência de falhas; ataques novos, correlação entre avaliadores e comprometimento de fornecedor permanecem possíveis. Casos inconclusivos mantêm promoção bloqueada. Aceitação de risco residual exige dono e justificativa; não permite dispensar as invariantes confirmadas de tenant, autorização e agenda.

## Protocolo de promoção proposto

1. Receber candidato em quarentena; schema permite apenas campos enumerados. Mudança de configuração que inclui código, template executável ou novo endpoint é recusada.
2. Fixar artefato e dependências por hash; avaliador separado executa corpus e gera atestado autenticado. A saída do candidato não escreve o resultado do teste.
3. Controlador verifica política vigente, identidade do avaliador, hash, conjunto/versão dos testes, completude, custo reservado, população e limites. Relatório parcial ou stale não aprova.
4. Executor verifica novamente autorização e epoch, com transição atômica na fonte de estado que controla ativação. O mesmo caminho vale para canário, ampliação e promoção. Só verificação anterior numa Queue não resolve a corrida de revogação.
5. Registrar pacote efetivamente ativo, auditoria e métricas do canário. Revogação cancela autorizações pendentes; reconciliação identifica qualquer execução em estado incerto antes de reprocessar.

A primeira política proposta permite somente ajustes enumerados de prompt/configuração, sob regras de backend fixas. Correções de código ficam no laboratório até política específica. Um relatório de segurança não concede autorização de implantação a um patch.

## Contenção e recuperação propostas

Gatilhos críticos: efeito não autorizado confirmado, exposição entre tenants/segredos, pacote sem atestado ou indício de comprometimento do controlador. Suspender imediatamente novas promoções e revogar autorizações pendentes; conter a capacidade operacional afetada pelo mecanismo aprovado, preservar IDs/versões e alertar o operador. Suspeita não permite apagar evidência nem aumentar privilégios.

O comando de parada precisa estar disponível por identidade operacional independente do otimizador e do Workflow; testar seu efeito sob indisponibilidade parcial. Pausar experimentos não cancela agenda. A pausa de conversa da DEC-083 continua permitindo confirmar proposta válida; um incidente no executor de confirmação exige contenção específica desse executor. Pix já pago continua no fluxo de conciliação, sem cobrança repetida.

Recuperação exige causa reproduzida, correção avaliada, credenciais rotacionadas quando aplicável, reconcilição de efeitos incertos, versão segura e política válida. Compromisso do plano de controle exige revisão humana antes de reativar a autonomia. Reversão automática de regressão comum continua permitida pela política. Tempo máximo de detecção/contenção e responsável de plantão: **Em aberto**, definidos antes do gate operacional.

## Gates de ativação e evidências

| Gate | Cobertura | Evidência obrigatória / responsável funcional |
| --- | --- | --- |
| EA-G01 — Autoridade | EA-T02/03/04/12 | Matriz de permissões efetivas, identidades e política aprovada; testes de revogação e integridade; Engenharia + Paulo |
| EA-G02 — Dados | EA-T01/05/11 | Relatórios A/B, acesso a corpus/logs, exclusão e restauração; GATE-04/06 existentes fechados para dados reais; Engenharia + jurídico |
| EA-G03 — Avaliação | EA-T06/07/10/15 | Corpus versionado, oráculos, calibração humana, testes adversariais e tolerâncias; qualidade + produto |
| EA-G04 — Recursos e laboratório | EA-T08/09 | Negação de egress/segredos, orçamento sob concorrência, timeout e repetição; Engenharia |
| EA-G05 — Operação | EA-T13/14 e parada independente | Exercício de canário, perda de telemetria, rollback, revogação e recuperação; tempos medidos e dono; operações |
| EA-G06 — Liberação | EA-G01–05 | Evidências revisadas por pessoa que não escreveu os controles; riscos residuais, configuração/versões e política aprovadas; Paulo + revisor |

**Estado de todos os gates: Em aberto / sem evidência nesta análise.** Nomes responsáveis continuam pendentes (NC-06). Cada relatório de teste registra commit, ambiente, configuração sem segredos, dados sintéticos, resultado esperado/observado, data e executor. Alteração material no componente protegido invalida evidência relacionada e exige reexecução. Haverá um teste positivo que conclui uma promoção válida sem aprovação individual, além dos negativos; um sistema que bloqueia tudo não satisfaz a DEC-084.

Ordem proposta: política/identidades e fronteiras → artefatos/atestado → testes de isolamento e avaliação → orçamento/laboratório → canário/rollback → revisão de liberação. Ao descobrir falha, abrir achado com severidade, dono, causa, controle, reprodução e critério de fechamento. Achado só fecha depois de correção e regressão verificadas.

## Base e limites desta revisão

Leitura documental da arquitetura evolutiva, decisões e registros AIMS em 31/10/2026. Sem inspeção de credenciais efetivas, dashboards, execução adversarial ou implementação do controlador. Os testes existentes do atendimento não comprovam a segurança do plano de evolução.

Referências consultadas: [OWASP — Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/?lang=us) para mínimo privilégio e autorização nos componentes que executam ações; [NIST AI RMF — Measure](https://airc.nist.gov/airmf-resources/playbook/measure/) para avaliação contextual e monitorização. A seleção dos cenários EA e dos gates é uma proposta específica para o Tredane, sem alegação de conformidade ou cobertura exaustiva dessas referências.
