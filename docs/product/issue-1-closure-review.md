# Revisão de encerramento da issue #1 — definição do MVP

**Estado:** preparação para revisão pelo responsável do produto, 24/10/2026. Não é aprovação de produto nem autorização de dados reais. A [issue #1](https://github.com/intentzero/tredane/issues/1) guarda o checklist histórico; a [auditoria de 23/10](definition-audit-2026-10-23.md) é uma fotografia 16/28 anterior à incorporação do PR #7 e às DEC-039–047. A execução está no [épico #14](https://github.com/intentzero/tredane/issues/14).

## Regra de encerramento

A #1 trata de **definição**. Não exigir código, conexão Meta, provedores reais ou ensaio com clínica para marcar uma **proposta documentada** como documentada. Ao mesmo tempo, uma descrição não aprova uma hipótese: para fechar a #1, o produto precisa rever prioridades e aceitar explicitamente as hipóteses adiadas, cada uma com responsável e gate. Validação de campo e go-live pertencem a #18/#45; implementação e provas técnicas, às issues #15–#44. Qualquer hipótese impeditiva da definição deve continuar aberta até decisão.

## Reconciliação dos 12 itens historicamente desmarcados

| ID | Estado para revisão | Evidência / saída necessária |
| --- | --- | --- |
| A-04 | Comportamento **Confirmado**, prova técnica pendente | DEC-020–026 e ADR-0008/0009 fixam convite, remoção e revogação. #23/#25 implementam/verificam o corte D1/DO/WS; conferir se o checkbox descreve definição ou implementação antes de marcá-lo. |
| F-01 | **Parcial** | Modelo lógico em `architecture/data-model.md`, REQ e DEC-038; cardinalidade oportunidade/contato e campos/anexos mínimos são hipóteses VAL-02/09, com gate antes de schema final (#29/#30/#34). |
| F-02 | **Parcial** | `states.md` e DEC-040 corrigem “Agendado” sem compromisso; reabertura, salto entre etapas, “Concluído” e auditoria granular exigem validação VAL-02 antes de máquina final (#30). |
| F-03 | Regras **Confirmadas**, valores reais pendentes | DEC-008/014 fixam duração, buffer também no profissional, recursos, fuso, expediente, bloqueios, 15 min, motivos e reagendamento; VAL-03 pede serviços/durações/jornadas da clínica antes de agenda final (#28/#35/#36). |
| F-04 | **Parcial** | DEC-009/040 confirmam Embedded Signup, janela de 24h e modelos; faltam política de anexos, textos/aprovação Meta e contratos de erro/estado (#31–#34, VAL-04/13). |
| F-05 | Parte **Confirmada**, qualidade a validar | DEC-011/040/046 confirmam Claude via AI Gateway, contexto mínimo, sugestão sob demanda, revisão humana, preço/texto aprovado/saúde. Limite numérico, detecção, logging e não retenção exigem avaliação (#41, VAL-05). |
| Q-02 | Decisão **Confirmada e incorporada** | DEC-038, ADR-0012 já na `main`. Marcar após revisão da PR; implementação e capacidade/recuperação ficam em #20/#23/#44, sem reabrir topologia. |
| Q-03 | **Parcial** | Clerk, roles, ausência de MFA, convites, prazos e aprovações definidos; handoff, CSRF, capacidades e verificação/propagação técnica seguem #21/#23/#26/#27/#32. |
| Q-04 | **Parcial** | DEC-011 confirma retenção enquanto cliente, exclusão de contato e tenant em 30 dias; anexos, logs, dados mínimos, terceiros e revisão jurídica antes de dados reais (#18/#34/#43). |
| Q-06 | Mobile first **Confirmado**, aparelhos pendentes | DEC-039/040/041 e UX-01–08 definem base; VAL-10/Q-UX-01 requerem modelos reais e observação da clínica antes de aceite piloto (#18/#42/#45). |
| V-01 | Racional **documentado, sujeito à aprovação do produto** | `requirements.md` prioriza MVP/interno/posterior/fora; revisar se Platform Admin/suporte e Pix mantêm recorte desejado e aceitar o racional. Não contar aprovação por existir uma tabela. |
| V-04 | Hipóteses **registradas**, não validadas | VAL-01–13 atribuem papel responsável e gate; revisão do produto deve aceitar adiamento dos itens não impeditivos antes de fechar a #1. Validação real permanece #18/#45. |

As outras 16 caixas foram registradas como documentação em 23/10; isso não implica aprovação final nem software pronto. **Não somar automaticamente** Q-02/V-04 a “18/28” antes de atualizar formalmente o checklist após revisão.

## Hipóteses que devem ser aceitas como condicionais

| Hipótese | Responsável funcional | Limite para resolver |
| --- | --- | --- |
| Nova conversa versus reabertura, campos mínimos, encerramento e etapa concluído | Produto + clínica piloto (VAL-01/02/09) | Antes de fixar schema/transições de #29/#30; dados sintéticos até lá |
| Configuração real de serviços, profissionais, recursos, duração e expediente | Produto + clínica piloto (VAL-03) | Antes de demonstrar agenda final em #35/#36 |
| Anexos, acesso a logs, dados pessoais e exclusão legal | Produto + privacidade/jurídico + clínica (VAL-09) | Antes de dados reais, #18/#34/#43 |
| Modelos/aprovação Meta, conta/número da clínica e registro Tech Provider | Produto + integração (VAL-04/13) | Antes de mensagens reais; #18/#31–#33 |
| Handoff, política de capacidades e revogação D1/DO/WS | Engenharia + segurança + produto (VAL-06/07/08) | Antes de acesso real; #23/#26/#27 |
| Uso assistivo da IA, avaliação de casos sensíveis e condição do terceiro | Produto + clínica + privacidade (VAL-05) | Antes de dados reais na IA; #18/#41 |
| Aparelhos reais, navegação e push | Produto + clínica piloto (VAL-10, Q-UX-01/05) | Antes de aceite UX em #42/#45 |
| Provedor Pix, política jurídica/fiscal e modelo de cobrança | Produto + engenharia + jurídico (ADR-0014, DEC-047) | Antes de cobrar cliente real; #17/#18/#37–#40 |

As decisões de produto **já confirmadas não são hipóteses**. Uma pendência técnica pode ser gate de implementação sem impedir encerrar a definição, desde que contrato observável e dono do gate estejam claros.

## Revisão final do produto

- [ ] Aprovar a prioridade MVP/interno/posterior/fora e o recorte da primeira demonstração, inclusive Platform Admin, suporte e Pix.
- [ ] Aceitar quais hipóteses acima podem seguir para o piloto como condicionais, sem fingir validação.
- [ ] Decidir se alguma lacuna de F-01/F-02/F-04/Q-03/Q-04 impede a definição e, se impedir, registrar decisão/critério e atualizar DEC/REQ/JRN/AC.
- [ ] Após incorporar as correções documentais, atualizar apenas os checkboxes comprovados da issue #1 e encerrar a issue se não restar bloqueio de definição.

**Saída:** revisão rastreável do produto e issue #1 coerente com o estado das decisões; não confundir com autorização de go-live.
