# Matriz de controles ISO/IEC 42001 — Tredane

**Estado:** **Proposto** (30/10/2026). Declaração de aplicabilidade do sistema de IA. Não é política aprovada, não é parecer jurídico e não afirma certificação. O procedimento está no [manual](aims.md). As não conformidades estão no [registo](aims-register.md).

**Norma:** ISO/IEC 42001:2023. Os identificadores e os títulos do Anexo A são os da norma. O texto de cada linha é um resumo de trabalho; a redação normativa não é reproduzida aqui.

**Quem aprova:** **Em aberto** (NC-06). O responsável pelo produto precisa aceitar o âmbito, a aplicabilidade e os nomes. Até lá, nenhum controle abaixo passa a **Confirmado** só porque o código existe.

## 1. Como ler

| Estado nesta matriz | Significado |
| --- | --- |
| **Parcial** | Há decisão, procedimento ou código que cobre parte do controle. Falta aceite, contrato, nome ou evidência com dados reais. |
| **Lacuna** | Não há artefato que satisfaça o controle. Nesta data, nenhuma linha do Anexo A está neste estado: as que eram lacuna passaram a procedimento **Proposto**. |
| **Coberto** | Controle operando, com dono e evidência alinhados à decisão. Nenhum controle está neste estado. Produção não está provisionada e o piloto com dados reais continua bloqueado (GATE-04, GATE-06, [#45](https://github.com/intentzero/tredane/issues/45)). |

Todos os 37 controles do Anexo A estão **aplicáveis**. Excluir um controle exige justificativa aceite pelo responsável pelo produto e registo neste ficheiro.

O [inventário de proteção](security-and-protection-inventory.md) descreve código e deploy. Esta matriz diz se isso chega ao controle da norma.

## 2. Sistema de IA no âmbito

O Tredane é o fornecedor e o operador. A clínica é cliente e fornece o catálogo. A atendente e a responsável usam o painel. A cliente da clínica é a pessoa afetada e não tem conta Tredane.

Entram neste âmbito:

1. **Sugestão e resumo** para a equipe (Claude via Cloudflare AI Gateway). Preço, explicação e pergunta de saúde seguem DEC-046. Contexto em DEC-011 / [ai-context-minimization.md](ai-context-minimization.md).
2. **Interpretação para proposta de horário.** A marcação só ocorre quando a cliente toca em **Confirmar** (DEC-061). Texto livre não marca. Serviço com sinal não reserva horário antes do Pix (DEC-047). A responsável pausa novas marcações automáticas na clínica.

Adendo de âmbito — 31/10/2026: a DEC-084 confirma evolução autónoma sob política e controlador independente. O [modelo de ameaças](evolucao-autonoma-threat-model.md) acrescenta EA-R01–15 e gates EA-G01–06, ainda sem evidência. Este adendo não promove controles da matriz a Cobertos. Ficam de fora treino próprio, resposta clínica, prontuário, campanhas e efeitos além das capacidades aprovadas.

**NC-01 — quem envia o texto sugerido.** DEC-063, ADR-0004, REQ-022 e [f5-ai-assist.md](../implementation/f5-ai-assist.md) dizem que a pessoa envia. [MVP.md](../MVP.md) (29/10/2026) diz que as mensagens sugeridas saem sozinhas, salvo injeção ou saída rejeitada. `src/ai/prompt.ts` diz que o sistema envia a mensagem sozinho. Esta matriz não escolhe. A.9 fica **Parcial**.

**NC-02 — contexto além da DEC-011.** O código envia campos que a DEC-011 não confirmou (H2, [ai-context-minimization.md](ai-context-minimization.md) §1). Não tratar o código como política.

## 3. Cláusulas 4 a 10 — sistema de gestão

| Cláusula | Estado | Onde | Pendência |
| --- | --- | --- | --- |
| 4 Contexto | **Parcial** | [aims.md](aims.md) §1; hipóteses do [dossiê jurídico](../product/legal-review-brief.md) | GATE-04 (NC-03) |
| 5 Liderança | **Parcial** | Política e papéis no manual §2 e §3 | Aceite do responsável pelo produto; nomes (NC-06). Revisão pela direção **Em aberto** |
| 6 Planeamento | **Parcial** | Método de risco no manual §5 | NC-01 e NC-02 abertas; sem objetivos medidos em produção |
| 7 Suporte | **Parcial** | Manual §4; tabela de competência com zero linhas | NC-06 |
| 8 Operação | **Parcial** | ADR-0004, F5, avaliação de impacto, runbooks | Dados reais bloqueados |
| 9 Avaliação | **Parcial** | Auditoria de 30/10/2026 no [registo](aims-register.md), com a limitação de não ser independente | Revisão pela direção **Em aberto** |
| 10 Melhoria | **Parcial** | NC-01 a NC-06 no registo, com o que fecha cada uma | Nenhuma NC fechada |

## 4. Anexo A

### A.2 Políticas relacionadas com IA

| Controle | Estado | Evidência | Pendência |
| --- | --- | --- | --- |
| **A.2.2** Política de IA | **Parcial** | [aims.md](aims.md) §2, a apontar às DEC já confirmadas | Aceite do responsável pelo produto. NC-01 e NC-02 ficam de fora da política até ele decidir. |
| **A.2.3** Alinhamento com outras políticas | **Parcial** | Manual §2; LGPD no dossiê; segurança no inventário | GATE-04. Mapa jurídico ainda é hipótese. |

### A.3 Organização interna

| Controle | Estado | Evidência | Pendência |
| --- | --- | --- | --- |
| **A.3.2** Papéis e responsabilidades de IA | **Parcial** | Manual §3. Atendente, responsável, produto, engenharia, jurídico, actor `system:ai-autobook` | Nomes (NC-06). Caminho da pergunta de saúde até a profissional sem login continua por definir. |
| **A.3.3** Comunicação de preocupações | **Parcial** | [ai-concern.md](../implementation/runbooks/ai-concern.md). Sem ecrã novo. Cliente fala com a atendente; a clínica fala com o Tredane pela sessão de suporte já existente | Procedimento **Proposto**. Nenhum caso registado. |

### A.4 Recursos dos sistemas de IA

| Controle | Estado | Evidência | Pendência |
| --- | --- | --- | --- |
| **A.4.2** Documentação de recursos | **Parcial** | [f5-ai-assist.md](../implementation/f5-ai-assist.md), ADR-0004, inventário de contexto, manual §4 | Continua espalhada. O manual não substitui o F5. |
| **A.4.3** Recursos de dados | **Parcial** | [ai-context-minimization.md](ai-context-minimization.md); testes AC-37 e S8 | NC-02. Limite de 20 mensagens **Proposto**. |
| **A.4.4** Ferramentas | **Parcial** | Claude via AI Gateway; `AI_MODE=synthetic` por defeito; headers de log e cache no código (DEC-011, F5) | NC-04. Modelo exato é configuração (ADR-0004). |
| **A.4.5** Sistemas e computação | **Parcial** | Worker, Durable Object com SQLite por clínica, D1, R2, Queues (DEC-038, ADR-0012) | Produção não provisionada ([DEPLOY.md](../DEPLOY.md)). |
| **A.4.6** Pessoas e competência | **Parcial** | Manual §4: o que cada papel precisa de saber. Tabela de registo vazia | NC-06. Não há formação registada. |

### A.5 Avaliação de impactos

| Controle | Estado | Evidência | Pendência |
| --- | --- | --- | --- |
| **A.5.2** Processo de avaliação de impacto | **Parcial** | Manual §5: repetir quando mudar o que a IA vê, o que ela causa, ou o fornecedor | Primeira execução está **Proposta**, não aceite. |
| **A.5.3** Documentação das avaliações | **Parcial** | [ai-impact-assessment.md](ai-impact-assessment.md), 30/10/2026 | Prazo de retenção acompanha GATE-04 (NC-05). |
| **A.5.4** Impacto em pessoas ou grupos | **Parcial** | A mesma avaliação: cliente, atendente, audiência do serviço (DEC-075), profissional sem login. Mitigações DEC-046, DEC-061, DEC-067 | NC-01. Dado sensível **Em aberto** (NC-03). |
| **A.5.5** Impacto societal | **Parcial** | Parágrafo na avaliação: atendimento comercial, risco de parecer orientação de saúde, risco de encher a agenda. Não excluído | H10 do piloto **Em aberto**. |

### A.6 Ciclo de vida

| Controle | Estado | Evidência | Pendência |
| --- | --- | --- | --- |
| **A.6.1.2** Objetivos de desenvolvimento responsável | **Parcial** | ADR-0004 e a exceção DEC-061, citados na política | Sem conjunto de objetivos aceite à parte. Autonomia nova exige ADR, como o próprio ADR-0004 diz. |
| **A.6.1.3** Processos de desenho e desenvolvimento responsáveis | **Parcial** | Manual §5 e §9: alargar contexto ou efeito espera DEC e nova avaliação | NC-02 mostra que o código chegou à frente da DEC. O processo escrito ainda não impediu isso. |
| **A.6.2.2** Requisitos e especificação | **Parcial** | REQ-022, REQ-072 a REQ-075, DEC-046, DEC-061 | Requisitos de impacto e de informação à clínica estão no manual, **Propostos**. |
| **A.6.2.3** Documentação de desenho e desenvolvimento | **Parcial** | [conversational-hybrid-model.md](../architecture/conversational-hybrid-model.md), ADR-0004, F5 | Leitura para a clínica está no manual §6, por publicar. |
| **A.6.2.4** Verificação e validação | **Parcial** | Testes de sugestão, minimização, injeção, abuso, proposta, resumo e clique. Harness S9 com piloto desligado | H9 e H10 **Em aberto**. |
| **A.6.2.5** Implantação | **Parcial** | Deploy com ambiente explícito; `AI_MODE=synthetic` até GATE-06 | Promoção a produção da IA não está escrita além dos gates. |
| **A.6.2.6** Operação e monitorização | **Parcial** | Logs sem corpo; quotas **Confirmadas** (29/10/2026), enable por clínica desligado até a responsável ligar; pausa em [ai-autobook-kill-switch.md](../implementation/runbooks/ai-autobook-kill-switch.md) | Taxa de edição e marcações indevidas não são um processo a correr. |
| **A.6.2.7** Documentação técnica | **Parcial** | F5 e ADR para quem desenvolve; manual §6 para a responsável | Texto ainda não entregue à clínica. |
| **A.6.2.8** Registo de eventos | **Parcial** | `ai_suggestions`; `appointment.ai_booked`; `proposal.created` e `proposal.confirm_refused` (id, versão, contato, conversa, motivo; sem corpo; replay não duplica). Testes em `proposals.test.ts` e `execute-confirm.test.ts` | NC-04 (log do Gateway) e NC-05 (prazo de `operational_audit`). |

### A.7 Dados para sistemas de IA

O Tredane não treina modelo. A.7 aplica-se à inferência e a qualquer uso futuro para melhorar o produto. Treino próprio está **Fora do MVP**.

| Controle | Estado | Evidência | Pendência |
| --- | --- | --- | --- |
| **A.7.2** Dados para desenvolvimento e melhoria | **Parcial** | Sem dataset de treino. Sugestão guardada na clínica para a decisão humana (ADR-0004) | Uso das conversas do piloto para avaliar qualidade depende do GATE-04. |
| **A.7.3** Obtenção de dados | **Parcial** | Webhook WhatsApp; catálogo escrito pela responsável (DEC-042, DEC-046) | Base legal: NC-03. O clique não é essa base (DEC-061). |
| **A.7.4** Qualidade dos dados | **Parcial** | Preço e explicação só do cadastro (DEC-046). Horários do caminho automático passam pelo bloco Tempo quando o serviço o tem (DEC-077) | NC-02. Sem processo de rever explicação desatualizada. |
| **A.7.5** Proveniência | **Parcial** | Direção da mensagem no campo `direction`. Origem da sugestão no histórico interno | Proveniência do fornecedor: NC-04. |
| **A.7.6** Preparação | **Parcial** | `sanitizeUntrusted`, redacção, schema fechado do rascunho, `guardSummaryOutput` no resumo (marcador, ferramenta, «marquei/enviei»; «ficou marcado» passa). Teste em `prompt-injection.test.ts` | Quem altera estas regras continua a ser engenharia, sem nome (NC-06). |

### A.8 Informação às partes interessadas

| Controle | Estado | Evidência | Pendência |
| --- | --- | --- | --- |
| **A.8.2** Documentação e informação a utilizadores | **Parcial** | Rótulos no [ux-ui.md](../product/ux-ui.md) §6.3. Texto para a responsável no manual §6, por publicar | Informar a cliente no WhatsApp: **Em aberto**, pedido na minuta de revisão. |
| **A.8.3** Reporte externo | **Parcial** | Manual §6: a determinação é que o dever não está fechado até o GATE-04. Enquanto isso não há comunicação a autoridade por causa da IA | NC-03. O estado está decidido como «não fechado»; a obrigação em si não. |
| **A.8.4** Comunicação de incidentes | **Parcial** | [incidents.md](../implementation/runbooks/incidents.md): dado de outra clínica, marcação indevida, conteúdo no log do Gateway. Pausa sem apagar o já marcado | Runbook **Proposto**. Quem avisa a clínica é produto, no dia em que o caso se confirma. |
| **A.8.5** Informação às partes interessadas | **Parcial** | Manual §1 e §6: o que a responsável recebe, o que ainda não vai à cliente, fornecedores no dossiê §3 | Publicação e contrato. O dossiê não é essa comunicação. |

### A.9 Uso do sistema de IA

| Controle | Estado | Evidência | Pendência |
| --- | --- | --- | --- |
| **A.9.2** Processos de uso responsável | **Parcial** | Opt-in de sugestões (F5). Quotas e pausa. Falha da IA não bloqueia resposta manual (AC-06). Saída rejeitada não vira rascunho nem resumo | NC-01. Quotas nascem desligadas: decisão **Confirmada**, o uso tem de saber disso. |
| **A.9.3** Objetivos de uso responsável | **Parcial** | Papel no MVP e exceção DEC-061, ambos citados na política sem vencedor | NC-01. Critério das 20 marcações revistas (H10) **Em aberto**. |
| **A.9.4** Uso pretendido | **Parcial** | Texto de uso pretendido e uso proibido no manual §6, ainda não entregue | Aceite e entrega à responsável. NC-01 muda a frase sobre quem envia. |

### A.10 Terceiros e clientes

| Controle | Estado | Evidência | Pendência |
| --- | --- | --- | --- |
| **A.10.2** Repartição de responsabilidades | **Parcial** | Hipótese no dossiê. Suporte com aprovação da responsável (DEC-029 a DEC-037). Manual §1 repete a hipótese sem a promover | NC-03. Quem responde à cliente por uma marcação do botão não está atribuído. |
| **A.10.3** Fornecedores | **Parcial** | Lista no dossiê §3. Evidência só em [pilot-gates.md](../product/pilot-gates.md) §4. Célula vazia não é aprovação. Headers no código não fecham o dashboard (manual §6) | NC-04 e os outros gates de terceiro. |
| **A.10.4** Clientes | **Parcial** | A responsável configura catálogo, explicação, quotas e pausa. Texto para ela está no manual §6 | Termos de uso da IA e publicação. Exclusão de contato existe no código; política jurídica é NC-03. |

## 5. Não conformidades abertas

O acompanhamento deixou de ser uma fila solta. Está no [registo](aims-register.md):

- NC-01 envio da sugestão
- NC-02 contexto H2
- NC-03 GATE-04
- NC-04 GATE-06
- NC-05 retenção de `operational_audit`
- NC-06 nomes dos papéis

A minuta de revisão pela direção, no mesmo registo, está **Em aberto**.

## 6. O que esta matriz não fecha

- **Confirmado** e usado só como evidência: DEC-011 (parcial), DEC-046, DEC-047, DEC-061, DEC-063, DEC-067, quotas de abuso (29/10/2026), pausa pela responsável.
- **Em aberto:** NC-01 a NC-06, H9/H10, produção, aceite desta matriz.
- **Fora do MVP:** treino de modelo e resposta clínica. NC-01 continua sobre envio; a evolução autónoma é direção confirmada separadamente pela DEC-084, com política e gates ainda pendentes.
- Nenhum controle está **Coberto**. A auditoria de 30/10/2026 conclui que o sistema não está conforme para certificação.
