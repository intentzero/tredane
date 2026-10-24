# Dossiê para revisão jurídica (LGPD)

**Estado:** **Proposto**, 24 de outubro de 2026. Reúne o que o produto já decidiu sobre dados pessoais e o que precisa de parecer jurídico. **Não é parecer nem decisão:** as qualificações jurídicas abaixo (controlador, operador, base legal, dado sensível) são hipóteses a confirmar. A revisão é pré-condição para usar dados reais (DEC-011, REQ-071, REQ-072, [ADR-0004](../adr/0004-ai-human-in-loop.md)). O piloto usa só dados fictícios até lá.

## 1. Quem trata o quê

| Papel | Hipótese | A confirmar |
| --- | --- | --- |
| Clínica | Controladora dos dados de seus clientes finais (contatos, conversas, agendamentos) | Sim/não; contrato de adesão |
| Tredane | Operadora desses dados; controladora dos dados de usuários da clínica (responsáveis e atendentes) | Papel exato em cada caso |
| Titulares | Cliente final da clínica; responsável e atendente | Como exercem direitos (pedem à clínica ou ao Tredane) |

## 2. Dados tratados

| Categoria | Onde fica | Observação |
| --- | --- | --- |
| Nome, telefone, mensagens e anexos do contato | SQLite do Durable Object da clínica; anexos em R2 privado por prefixo de clínica ([DEC-038](decisions.md)) | Mensagens de clínica de estética podem citar procedimentos ou condições de saúde: **tratar como possível dado sensível?** |
| Agendamentos (serviço, horário, profissional) | SQLite do Durable Object | Permanece anonimizado se o contato for excluído |
| Identidade de usuários (nome, e-mail, sessão) | Clerk; memberships e convites no D1 central | Nenhum dado de atendimento no Clerk (DEC-043) |
| Registros de suporte (ator, usuário representado, aprovador, horários) | D1 central | Sem conteúdo clínico; retenção a definir |
| Logs técnicos | Cloudflare | Sem tokens nem mensagens completas (REQ-070); retenção **em aberto** |

## 3. Fluxos para terceiros

| Terceiro | O que recebe | Situação |
| --- | --- | --- |
| Meta (WhatsApp Business) | Mensagens enviadas e recebidas; número da clínica | Tredane como Tech Provider (DEC-009); termos da Meta a revisar |
| Anthropic, via Cloudflare AI Gateway | Até 20 mensagens recentes, primeiro nome, catálogo de serviços (com a explicação para clientes, DEC-046) e etapa; nunca telefone, anexos, outras conversas nem dados de outra clínica | Gateway sem registro de conteúdo e não retenção pelo provedor **precisam de confirmação contratual** (DEC-011) |
| Clerk | Nome, e-mail, sessão | Plano, DPA e região a conferir (DEC-043) |
| Provedor de Pix (ADR-0014, a escolher) | Cobranças do sinal na conta da clínica: valor, identificador, estado e dados que o provedor exigir para estorno | Contrato, DPA e se o Tredane atua só como tecnologia, sem intermediar o dinheiro (DEC-047) |
| Cloudflare | Hospedagem de tudo acima | DPA e regiões dos Durable Objects, D1 e R2 a conferir |

## 4. Retenção e exclusão (Confirmado, sujeito a esta revisão)

- Dados ficam enquanto a clínica for cliente, sem prazo fixo.
- O responsável pode excluir um contato: apaga mensagens e anexos; o agendamento permanece anonimizado.
- Ao encerrar a conta: exclusão total em até 30 dias (SQLite do DO e prefixo R2).
- Suporte do Tredane: acesso só com aprovação do responsável, sessão de 30 min, com auditoria (DEC-029 a DEC-037).

## 5. Perguntas para o advogado

1. Qual a base legal de cada tratamento e quem a registra: clínica, Tredane ou ambos?
2. Mensagens e anexos devem ser tratados como dados sensíveis (saúde)? Muda a base legal, o consentimento ou a IA?
3. Enviar trechos de conversa a um provedor de IA no exterior exige consentimento específico, cláusulas contratuais ou aviso ao titular?
4. A transferência internacional (Anthropic, Cloudflare, Clerk, Meta) está coberta por quais instrumentos? É necessário escolher região de hospedagem?
5. A exclusão por contato, a anonimização do agendamento e o prazo de 30 dias no encerramento são suficientes? Há prazo legal mínimo de guarda (por exemplo, registros de atendimento)?
6. Como o titular exerce acesso, correção e exclusão: pela clínica, pelo Tredane, ou pelos dois? Qual o prazo?
7. O acesso de suporte aprovado por sessão (30 min, só leitura/diagnóstico) é suficiente e que registro de auditoria exige guarda, e por quanto tempo?
8. Que contrato é necessário entre Tredane e clínica (termos de uso, acordo de tratamento de dados) e o que precisa constar?
9. Plano de resposta a incidente: prazo e responsável pela comunicação à ANPD e aos titulares.
10. O sinal por Pix (DEC-047) exige recibo, nota fiscal ou cláusula específica no contrato com a clínica e na informação à cliente? Reter o sinal no cancelamento tem limites legais?
11. Retenção dos logs técnicos e dos registros de suporte: prazo máximo recomendado.

## 6. O que bloqueia

| Item | Bloqueia |
| --- | --- |
| Parecer sobre sensível, base legal e transferência internacional | Uso de dados reais e go-live com clínica real |
| Contrato com Tredane/clínica e política de privacidade | Go-live |
| Configuração do AI Gateway sem registro de conteúdo e confirmação do provedor | Ativar IA com dados reais |
| Política de retenção de logs | Go-live; não bloqueia a F0 |

**Responsável pela decisão:** responsável pelo produto, com o parecer do advogado. **Em aberto:** quem contrata o advogado e a data limite.

## 7. Rastreio operacional

Os bloqueadores GATE-03/04/05/06/07/08/09/11 e o estado de cada evidência de terceiro ficam em [pilot-gates.md](pilot-gates.md) (issue #18). Rascunhos de modelos WhatsApp (incluindo cobrança Pix): [whatsapp-templates-draft.md](whatsapp-templates-draft.md). Este dossiê continua a ser a fonte das perguntas jurídicas; o registro de gates não as substitui.
