# ADR-0004 — IA assistiva com revisão humana no primeiro recorte

- **Estado:** Recorte proposto e registado no MVP. **Aceitos** em 23/10/2026 o provedor, o contexto e a retenção ([DEC-011](../product/decisions.md)); revisão jurídica pendente antes de dados reais.
- **Origem:** [DEC-006](../product/decisions.md), [REQ-022 / REQ-072](../product/requirements.md).

## Contexto

Atendimento de estética envolve preços, disponibilidade e potenciais perguntas de saúde. O primeiro piloto deve avaliar qualidade da IA sem permitir mensagens inadequadas ou ações comerciais autónomas.

## Regra do MVP

A IA pode resumir conversa e sugerir respostas. A sugestão é claramente identificada e editável; só é enviada por ação explícita do atendente ou responsável autenticado. O envio humano respeita as regras da integração WhatsApp. A IA não reserva, cancela ou confirma horários por conta própria na primeira entrega.

## Limites

Não enviar ao provedor informações de outra clínica, anexos ou dados sensíveis por defeito; definir contexto mínimo, retenção, políticas do provedor e exclusão antes de dados reais. Recomendações clínicas, contraindicações e diagnósticos devem ser encaminhados a profissionais qualificados; nunca apresentar a saída como orientação médica.

## Implementação proposta

Adaptador de provedor com contratos tipados, acesso apenas a dados autorizados pelo domínio, identificação da origem/modelo de cada sugestão, revisão humana auditável e indisponibilidade graciosa (atendimento manual permanece operacional).

**Provedor (Confirmado):** Claude (Anthropic), chamado pelo Worker através do Cloudflare AI Gateway, para limites de uso, métricas de custo/latência e troca de provedor sem mudar o domínio. Workers AI e chamada direta à API foram descartados para o piloto. **Proposto:** modelo rápido para resumos e modelo mais capaz para sugestões; o modelo exato é configuração, não código.

**Contexto enviado (Confirmado):** mensagens recentes da conversa (proposta: até 20), primeiro nome do contato, catálogo de serviços da clínica (nome, duração, preço) e etapa da oportunidade. Nunca: telefone, anexos, outras conversas, dados de outra clínica ou credenciais.

**Retenção (Confirmado, sujeito a revisão jurídica):** o AI Gateway deve ser configurado sem registrar o conteúdo das solicitações e respostas, e o provedor não pode reter as solicitações. O Tredane guarda em `ai_suggestions` apenas o texto sugerido, o modelo e a decisão humana, no armazenamento da clínica (SQLite do Durable Object, [ADR-0012](0012-clinic-durable-object-sqlite.md)).

## Critérios de validação

Cenários de preços ausentes, horário indisponível, risco clínico, mudança de contexto, tentativa de prompt injection e contexto de clínica errada. Medir qualidade da sugestão, percentagem editada/aceita, latência e custo. Autonomia futura exige novo ADR e critérios específicos.

**Atualização (24/10/2026, DEC-046):** preço só do cadastro, explicação de procedimento só com o texto “Explicação para clientes” de cada serviço, pergunta clínica encaminhada à profissional e resposta cordial com aviso para mensagem ofensiva ou fora do assunto. O contexto enviado passa a incluir essa explicação (texto da clínica, sem dado pessoal). Ver REQ-073 a REQ-075.

**Atualização (28/10/2026, DEC-060 e revisão DEC-061, Decidido 28/10/2026):** exceção à regra «A IA não reserva»: um compromisso pode ser criado automaticamente (actor `system:ai-autobook`) **apenas** quando a própria cliente toca no botão de confirmação do WhatsApp de uma proposta montada e versionada pelo backend (id + versão, mesmo tenant/contato/conversa, válida por 30 min). O LLM só interpreta o pedido e não autoriza nada: texto livre («sim», 👍, pedido completo) nunca marca. A proposta e o resultado são mensagens determinísticas de texto fixo do backend; envio livre pelo LLM continua fora. No clique, o backend revalida na transação pelo caminho das marcações manuais, de forma idempotente por proposta/versão; serviço com sinal segue o Pix (DEC-047), sem reserva antes do pagamento. «Alterar detalhes», dúvidas, cancelamento e remarcação vão para a atendente. O clique não é consentimento LGPD nem prova de identidade civil. Flag `AI_AUTOBOOK` desligada por padrão; piloto com alerta de comunicação pendente aos 5 min e contenção até 20 marcações revistas sem nenhuma indevida. Critérios de validação adicionais: prompt injection que tente marcar, «sim» deslocado, proposta expirada/antiga, clique duplicado, clique de outro contato/tenant. **Limites de abuso (S7): Confirmado (Paulo, 29/10/2026)** — ver `docs/security/abuse-limits.md`; `ABUSE_LIMITS` off até ops; sem UI. O contexto da IA continua o de DEC-011; ampliá-lo exige revisar DEC-011. Este ADR serve de registo da exceção até haver ADR próprio.
