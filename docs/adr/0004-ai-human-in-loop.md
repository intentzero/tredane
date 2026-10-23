# ADR-0004 — IA assistiva com revisão humana no primeiro recorte

- **Estado:** Recorte atual proposto e registado no MVP; aceitação final da política de dados/provedor pendente.
- **Origem:** [DEC-006](../product/decisions.md), [REQ-022 / REQ-060](../product/requirements.md).

## Contexto

Atendimento de estética envolve preços, disponibilidade e potenciais perguntas de saúde. O primeiro piloto deve avaliar qualidade da IA sem permitir mensagens inadequadas ou ações comerciais autónomas.

## Regra do MVP

A IA pode resumir conversa e sugerir respostas. A sugestão é claramente identificada e editável; só é enviada por ação explícita do atendente ou responsável autenticado. O envio humano respeita as regras da integração WhatsApp. A IA não reserva, cancela ou confirma horários por conta própria na primeira entrega.

## Limites

Não enviar ao provedor informações de outra clínica, anexos ou dados sensíveis por defeito; definir contexto mínimo, retenção, políticas do provedor e exclusão antes de dados reais. Recomendações clínicas, contraindicações e diagnósticos devem ser encaminhados a profissionais qualificados; nunca apresentar a saída como orientação médica.

## Implementação proposta

Adaptador de provedor com contratos tipados, acesso apenas a dados autorizados pelo domínio, identificação da origem/modelo de cada sugestão, revisão humana auditável e indisponibilidade graciosa (atendimento manual permanece operacional). Workers AI é candidato, **não uma escolha confirmada de modelo**.

## Critérios de validação

Cenários de preços ausentes, horário indisponível, risco clínico, mudança de contexto, tentativa de prompt injection e contexto de clínica errada. Medir qualidade da sugestão, percentagem editada/aceita, latência e custo. Autonomia futura exige novo ADR e critérios específicos.
