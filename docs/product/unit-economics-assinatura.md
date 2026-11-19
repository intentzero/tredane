# Unit economics da assinatura por clínica

**Estado:** tabela de preços de referência **Confirmada** (Paulo Santos, 19/11/2026, America/Sao_Paulo); premissas de custo, margem e regime continuam **Propostas**. Estudo de 18/11/2026; a lista Estúdio / Clínica / Casa abaixo é a mesma que a landing publica. Não muda o recorte do MVP.

O modelo editável está em [unit-economics-assinatura.canvas.tsx](unit-economics-assinatura.canvas.tsx), ao lado deste texto. Ele importa `cursor/canvas` e serve para refinar premissas (conversas, horas de suporte, regime, quem paga a Meta). A leitura abaixo é o caso-base gravado nesta data. Se o canvas divergir na tabela de preços, vale a tabela Confirmada; nas premissas de custo, vale o que estiver no arquivo do repositório depois da próxima revisão.

## Preços de referência Confirmados

**Confirmado (Paulo Santos, 19/11/2026):** três mensalidades de referência na landing. **Proposto** (estudo de 18/11/2026): Meta na conta da clínica, sinal Pix em todos os planos, anual = 10 meses (dois grátis). A régua de «60% da nota» deixa de definir o preço: ela só avisa quando o piloto, com hora de gente dentro da mensalidade, fica fino.

| Plano | Mensal | No anual | Cabe | Sobra no piloto | Sobra em regime |
| --- | ---: | ---: | --- | ---: | ---: |
| Estúdio | R$ 149 | R$ 124 | 1 profissional, 1 login | cerca de 11% | cerca de 62% |
| Clínica | R$ 247 | R$ 206 | até 4 profissionais, 3 logins | cerca de 20% | cerca de 67% |
| Casa | R$ 397 | R$ 331 | até 10 profissionais | cerca de 20% | cerca de 68% |

Colunas Mensal / No anual / Cabe: **Confirmadas**. Colunas de sobra: **Propostas** (modelo).

Anexo V a 15,5%, remessa de SaaS técnico, hora interna a R$ 80. O piloto do estúdio conta 1 h e 3 h de onboarding diluídas; o da clínica, 1,5 h e 4 h; o da casa, 2,5 h e 6 h. Em regime essas horas caem para 0,3 h, 0,4 h e 0,6 h. Abaixo de R$ 149 o estúdio não paga a hora do piloto: a R$ 97 a sobra do mês de entrada fica negativa.

O que segura esses preços é teto de suporte, não um número maior na tabela. Depois do onboarding o canal é chat. Hora extra de alguém da operação não entra na mensalidade. Se a casa exigir as 2,5 h todo mês, o preço de R$ 397 não segura o piloto: cobra-se um setup único (a Belle cobra R$ 190 de adesão; a Clinicorp cobra implementação) em vez de subir a mensalidade para R$ 697.

Pix não fica atrás de um plano mais caro. No Atendize o Pix que confirma o horário só aparece a R$ 497. No Tredane ele já é o produto (DEC-047), nos três planos.

## O que a vitrine cobra de fato

Páginas públicas conferidas em 18/11/2026. O número que a clínica lembra é o da promoção, não o de tabela.

**Agenda de salão e estética.** É aqui que o estúdio compara.

| Oferta | Preço que aparece | O que o anúncio esconde |
| --- | --- | --- |
| Gendo Básico, 1 profissional | R$ 24,70/mês | Metade de R$ 49,98, no anual. 100 notificações de WhatsApp. Sem caixa. |
| Genda PRO | R$ 39,90 | Plano grátis permanente com 50 mensagens. |
| Fresha, autônomo | R$ 39,95 | 20 mensagens grátis; depois R$ 0,20 a R$ 1,50 cada. Imposto à parte. |
| Trinks, 1 a 2 profissionais | R$ 55 no mensal, R$ 38 no anual | Promoção de 50% nos 6 primeiros meses em oferta vigente. WhatsApp é adicional, preço não publicado. Semestral e anual têm fidelidade. |
| Simples Agenda, 1 profissional | R$ 59,90 no anual, R$ 89,90 no mensal | WhatsApp pelo QR code, com 5 minutos entre mensagens. |
| Avec, 1 a 2 | R$ 99,90 no mensal, R$ 88,90 no anual | WhatsApp oficial e a IA de recepção são adicionais, sem preço. |
| Clinicorp Standard | R$ 111,93 | Tabela R$ 159,90. Implementação obrigatória à parte. Confirmação a R$ 0,12 por envio, de um número que não é o da clínica. |
| Belle, 1 a 2, com WhatsApp | cerca de R$ 371 | Sistema R$ 142 mais adesão R$ 190 mais módulo BelleMessage R$ 229. |

**WhatsApp como produto.** Só esta prateleira entrega marcação na conversa. Mesmo assim o estúdio quase não chega nela: ela continua no aplicativo grátis.

| Oferta | Preço | Leitura |
| --- | --- | --- |
| Atendize Básico | R$ 197 | Até 3 atendentes, QR code, sem tarifa por mensagem. Sem a IA que marca. Página do próprio Atendize. |
| Atendize com agenda e IA | R$ 397 | A IA consulta a agenda e marca. |
| Atendize Profissional | R$ 497 | Pix na conversa, até 10 pessoas. |
| Umbler Talk | R$ 99,90 por atendente | Mínimo de 2, então R$ 200, sem agenda nativa. |
| BotConversa | R$ 189 no anual | Fluxo, não agenda de clínica. |
| Zenvia Specialist | R$ 600 | Mais pacote de WhatsApp desde R$ 100 e ativação de R$ 649. |
| Take Blip | desde R$ 1.023 | Preço de consulta. Não é o comprador do estúdio. |

A leitura agressiva: R$ 499 no estúdio empilha o teto do Atendize (inbox, equipe e Pix) em cima de um produto que ainda não tem financeiro, prontuário nem pacote de sessões, e cobra isso de quem está olhando Trinks a R$ 55. A API oficial, que é o nosso custo e o nosso diferencial, não vale R$ 400 por mês para quem hoje manda mensagem de graça no aplicativo. Ela passa a valer quando o número não oficial cai ou quando a clínica quer o botão e o Pix no número dela.

O módulo de WhatsApp da Belle, R$ 229, é o teto honesto de um adicional em cima de um sistema que a clínica já paga. O Tredane, sozinho, inclui a agenda e o pipeline, então pode passar desses R$ 229 na clínica com equipe. Não pode custar o sistema da Belle inteiro mais o módulo.

## O que entra no custo de uma clínica

O custo que manda no piloto é hora de gente. A IA e a Cloudflare, mesmo com o tributo da remessa, ficam na casa de poucos reais por clínica neste volume.

| Linha | Caso-base, clínica pequena | Quem paga |
| --- | ---: | --- |
| IA (Haiku 5.5 no caminho quente, Sonnet 5.5 no «gerar outra») | cerca de R$ 2,50 | Tredane |
| Infra Cloudflare (hipótese de US$ 1 × câmbio) | R$ 5,40 | Tredane |
| Tributos da remessa em dólar | cerca de R$ 4 | Tredane, fora do DAS |
| Suporte no piloto, 1,5 h × R$ 80 | R$ 120 | Tredane |
| Onboarding de 4 h, diluído em 12 meses | cerca de R$ 27 | Tredane |
| WhatsApp service + utility | cerca de R$ 22 | Clínica, na conta do número |
| **Custo do Tredane no piloto** | **cerca de R$ 158** | |

Em regime (0,4 h de suporte por mês, onboarding já pago) o custo cai para a casa dos R$ 40 mais os mesmos tributos da nota. A margem em regime, no preço que segura o piloto, fica folgada. O primeiro mês tira as horas de onboarding inteiras do caixa; a tabela mostra a média de doze meses.

## Perfis

Os três perfis usam a mesma hora (R$ 80), o mesmo câmbio (R$ 5,40) e o mesmo pacote de imposto. O degrau de 60% da nota é só o alerta de custo. O preço proposto está na tabela do início.

| Perfil | Volume de partida | Preço proposto | Alerta de 60% da nota |
| --- | --- | ---: | --- |
| Estúdio, 1 profissional | 80 conversas, 1 h de suporte no piloto | R$ 149 | O piso de 60% fica perto de R$ 450. O preço de prateleira aceita cerca de 11% no piloto. |
| Clínica, 2 a 4 | 200 conversas, 8 saídas de serviço, 1,5 h | R$ 247 | No Anexo V o piso de 60% continua perto de R$ 650. Não é o preço de lista. |
| Casa, 5 a 10 | 500 conversas, 2,5 h de suporte | R$ 397 | O piso de 60% passa de R$ 1.000 se essas horas ficarem todo mês. O teto de suporte é o que segura R$ 397. |

## Fórmula

```
custo = IA + infra + tributo da remessa + suporte + onboarding diluído + Meta absorvida
imposto da nota = mensalidade × alíquota efetiva
sobra = mensalidade − imposto da nota − custo
piso para 60% da nota = custo / (1 − alíquota − 0,60)
```

A alíquota efetiva do Simples é `(RBT12 × nominal − parcela a deduzir) / RBT12`. RBT12, neste estudo, é a receita anualizada `clínicas pagantes × mensalidade testada × 12`. Com 15 clínicas a R$ 397–697 a receita fica na primeira faixa (até R$ 180 mil). Acima disso a alíquota sobe; o canvas recalcula.

Meta absorvida só entra no custo se o Tredane pagar a conta. No caso-base a conta é da clínica (DEC-009) e o valor não entra na nota do Tredane.

## Imposto da nota

**Proposto como caso-base:** Simples Nacional, Anexo V, 15,5% na primeira faixa. SaaS de software próprio segue o fator R (folha ÷ receita bruta dos 12 meses). Abaixo de 28%, Anexo V. Em 28% ou mais, Anexo III, que começa em 6%. Fontes usadas em 18/11/2026: LC 123/2006, anexos III e V; SC Cosit 222/2019 e 271/2024 para licenciamento do próprio software.

No Simples e no Lucro Presumido esse imposto incide sobre a receita. A fatura da Cloudflare não o reduz.

Lucro Presumido, neste estudo: ISS da cidade + PIS 0,65% + COFINS 3% + IRPJ 4,8% + CSLL 2,88% (15% e 9% sobre presunção de 32%). Com ISS de 2%, cerca de 13,3% da nota. Com ISS de 5%, cerca de 16,3%. O adicional de 10% de IRPJ aparece quando o lucro presumido do mês passa de R$ 20 mil.

| Regime na clínica pequena, a R$ 497 | Efeito no caso-base |
| --- | --- |
| Anexo V, 15,5% | Sobra cerca de 53% da nota no piloto. O degrau de 60% é R$ 697. |
| Anexo III, 6% | O degrau de 60% volta a R$ 497. |
| Lucro Presumido, ISS 2% | Fica entre os dois. Conferir no canvas. |
| Lucro Presumido, ISS 5% | Perto do Anexo V. |

## Remessa: Cloudflare e Anthropic

**Proposto como caso-base**, e **em aberto** quanto ao enquadramento. Cloudflare e Anthropic cobram em dólar. O DAS não inclui essa remessa (LC 123/2006, art. 13, § 1º). Quando o fornecedor recebe o valor cheio, o estudo soma, sobre a fatura de IA + infra:

- IOF-câmbio 3,5% (Decreto 12.499/2025, citado em novembro de 2026; o referendo do plenário do STF na ADC 96 ainda estava pendente na fonte consultada)
- IRRF 15% com gross-up, 17,65% do valor pago (RIR/2018, art. 786)
- CIDE 10% sobre a base reajustada, se a nuvem for serviço técnico (SC Cosit 191/2017)
- PIS/Cofins-Importação 9,25%, base reajustada (IN RFB 2.121/2022, art. 273)
- ISS da importação, 2% no caso-base (o município pode ir a 5%)

O conjunto fica em cerca de 47% a mais sobre a fatura em dólar. Em cerca de R$ 8 de fatura, são cerca de R$ 4 por clínica por mês. Não muda o degrau de R$ 697.

O canvas tem mais duas leituras: licença de uso sem CIDE (SC Cosit 107/2023) e só o IOF de 3,5%, que é o que o cartão cobra mesmo sem a empresa recolher o resto.

A partir de 2027 o PIS/Cofins-Importação dá lugar à CBS. IRRF e CIDE permanecem. Vale revisar esta secção nessa data.

## Meta

**Confirmado para o desenho do produto, hipótese para o caixa:** a conta e o número são da clínica (DEC-009). O caso-base deixa a fatura fora da mensalidade do Tredane. Cartão Brasil de 1/10/2026: service R$ 0,035 a partir da mensagem 1.001 de cada número, por mês; utility R$ 0,035. As 1.000 primeiras de serviço são grátis e não acumulam. Marketing, R$ 0,3217, fica de fora: campanha e lembrete de retorno não estão neste recorte.

A cobrança em reais sai em boleto da Facebook Brasil. Isso não é remessa ao exterior, então IOF, IRRF e CIDE da secção anterior não se aplicam a essa fatura. O repasse de PIS/Cofins 9,25% e ISS 2,9% que a Meta anunciou para 2026 é de anúncio, não do cartão de mensagem da API. Se a conta da API voltar a ser faturada em dólar pela Meta Platforms Inc., a remessa da secção anterior passa a incidir também sobre ela.

Pix de sinal cai na conta da clínica (DEC-047). Não há take rate do Tredane neste estudo.

## De onde vêm os números de custo

- Modelos em `src/ai/budgets.ts`: extrator, exceção e rascunho automático em `claude-haiku-5-5`; «gerar outra» em `claude-sonnet-5-5`. Teto de 300 rascunhos por dia por clínica (`AI_DAILY_DRAFT_CAP`). No Haiku, mesmo o teto cheio fica na casa de dezenas de reais.
- Preço Anthropic usado (prompt até 100 mil tokens): Haiku 5.5 US$ 0,10 / US$ 0,50 por milhão; Sonnet 5.5 US$ 2 / US$ 10. Cada chamada de Haiku, na hipótese: 2.500 tokens de entrada e 600 de saída, thinking incluído. Sonnet: 4.000 e 800.
- Caminho de agenda é frase do backend (DEC-104). A chamada de Haiku entra quando o código não cobre a mensagem.
- Infra de US$ 1 por clínica é hipótese da parcela variável (Worker, Durable Object, D1, Clerk). O mínimo da conta Cloudflare fica no custo fixo da empresa, não nesta linha, para não contar duas vezes.
- Câmbio R$ 5,40 por dólar é hipótese.
- Hora de suporte R$ 80 é hipótese de alguém da operação, não salário aprovado.

## Custo fixo da empresa

O canvas separa um custo fixo mensal (hipótese de partida R$ 12.000, ferramentas e retirada, fora do custo por clínica). A conta de quantas clínicas cobrem esse fixo usa a sobra em regime do preço proposto, não o degrau de 60%. No estúdio a R$ 149 sobram cerca de R$ 93 em regime: o fixo de R$ 12.000 pede cerca de 130 estúdios. Na clínica a R$ 247 sobram cerca de R$ 165: cerca de 73 clínicas. A casa a R$ 397, com cerca de R$ 271, pede cerca de 45. Misturar os planos melhora essa conta; enchê-la só de estúdio a R$ 149 não paga um time.

## Em aberto

- Regime tributário. Sem CNPJ, Anexo V é a hipótese conservadora, não enquadramento.
- Enquadramento da Cloudflare e da Anthropic: serviço técnico com CIDE, ou licença sem CIDE.
- Horas reais de suporte no piloto e volume real de conversas. Ainda não há clínica pagante.
- Quem paga a Meta no contrato: a clínica, como na DEC-009, ou o Tredane por dentro da mensalidade.
- ISS do município, quando houver sede.
- Condições comerciais do piloto com cada clínica (desconto, adesão, setup) e se o estúdio na prática assina mais perto de outro valor. Abaixo de R$ 149 a hora do piloto deixa de se pagar (leitura do modelo).

## Ao refinar

1. Mudar a premissa no [canvas](unit-economics-assinatura.canvas.tsx) e conferir o degrau.
2. Se a leitura de caso-base mudar, atualizar a tabela deste arquivo na mesma alteração.
3. A lista de preços de referência já está **Confirmada** (19/11/2026) e publicada na landing ([landing.md](landing.md)). Regime tributário, quem paga a Meta e condições do piloto por clínica continuam **Em aberto**; quando fecharem, registam-se em DEC e este estudo continua como a conta que as sustentou.
