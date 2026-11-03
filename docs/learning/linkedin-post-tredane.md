# Rascunho LinkedIn — lições Tredane (conversa → domínio)

**Estado:** rascunho (**Proposto** para publicação). Conteúdo alinhado a decisões **Confirmadas** do produto onde indicado nas notas.  
**Não inventa** métricas nem usa dados reais de clínicas ou clientes.  
**Tom:** português do produto (claro, directo; misturar PT-BR/PT-PT como no copy já aprovado à cliente).  
**Foco:** lições transferíveis — canal → domínio, id vs rótulo, fronteira de confirmação, IA assistiva.  
**Material-fonte:** não é especificação; ver [README.md](README.md) e [`docs/MVP.md`](../MVP.md).

---

## Versão completa (~1650 caracteres úteis)

Construir atendimento no WhatsApp ensinou-nos uma coisa incómoda: o canal dita o modelo de domínio.

No WhatsApp, uma lista costuma ser um toque só. Uma combinação («duas zonas no mesmo horário») não cabe nesse gesto. Se o bot avançar com metade do que a pessoa pediu, ela acredita no pedido completo — e o sistema marca uma parte. O defeito não é «falta de empatia». É um quadro incompleto a passar por completo.

Trabalhámos nisto num SaaS multi-tenant para clínicas de estética: mensagem → proposta → confirmação na agenda própria, com núcleo determinístico e IA só onde o código não chega.

Quatro lições transferíveis:

1. **O canal molda o domínio.** Single-select exige um «quadro» partilhado (serviço, opções, horário) e um caminho estruturado para o preencher. Não se remenda só com mais frases.

2. **Id, nunca o rótulo.** O que a pessoa vê («terça 03/11 17:00») é copy. O sistema grava um identificador estável. Relêr o título como verdade perde o dia e parte a confirmação.

3. **Fronteira explícita de efeito.** Interpretar não é marcar. Só um botão numa proposta versionada pelo backend cria o compromisso. «Sim» escrito prepara; não grava.

4. **IA assistiva, núcleo determinístico.** A linguagem ajuda a ler o pedido. Regra, catálogo e agenda decidem o que sai e o que marca. Medimos se o resultado bateu no pedido — não se a frase «soou bem».

Vamos reforçar o caminho estruturado (formulário no WhatsApp, alimentado pela agenda). O chat fica como atalho e rede de segurança. A regra do quadro e da confirmação permanece.

Se ligas mensagens a efeitos reais (marcar, cobrar, reservar): desenha primeiro o quadro e a fronteira. O tom vem depois.

---

## Versão curta (~520 caracteres)

No WhatsApp, o canal dita o domínio: lista = um toque; combinações pedem um quadro partilhado. Se o bot avançar com metade do pedido, a pessoa acredita no completo — e o estrago é de dados, não de tom.

Lições: (1) estrutura para colher, chat para confirmar; (2) gravar id, não o rótulo do ecrã; (3) só um gesto explícito cria o efeito (marcar); (4) IA a ajudar a ler, regras a decidir.

Estamos a aplicar isto no Tredane (clínicas, WhatsApp, agenda). Vale para qualquer produto em que uma mensagem dispare um compromisso real.

---

## Títulos alternativos

1. O canal de mensagens dita o teu modelo de domínio  
2. «Sim» não deve marcar: fronteiras numa conversa com efeitos reais  
3. Id ≠ rótulo — a lição mais cara de uma lista no WhatsApp  

---

## Hashtags sugeridas (usar com parcimónia; 3–5 no fim do post)

`#ProductArchitecture` `#ConversationalAI` `#WhatsAppBusiness` `#SaaS` `#HumanInTheLoop`

Opcionais (PT): `#ArquiteturaDeSoftware` `#ProdutoDigital`

Evitar hashtags vazias (#Inovação, #FuturoDoTrabalho) e qualquer menção a clínicas, pacientes ou volumes reais.

---

## Notas de publicação (para o Paulo)

- **Confirmado no produto, seguro de dizer em público:** fronteira botão vs texto (DEC-061); núcleo + IA assistiva (DEC-104); quadro único (ADR-0015); caminho Flow como intenção de produto (DEC-138) — sem prometer data de lançamento.
- **Não publicar:** nomes de clínicas, WABA, métricas de conversão, detalhes de cifra Meta, estado de deploy.
- **Em aberto:** se quiseres citar «Flow» pelo nome Meta no post, ou ficar só em «formulário no WhatsApp».

Base detalhada: [licoes-arquitectura-tredane.md](licoes-arquitectura-tredane.md).
