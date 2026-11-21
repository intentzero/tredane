# Como o Tredane atende no WhatsApp sem deixar a IA inventar a resposta

**Publicação prevista:** Opus Naturalis  
**Por:** Paulo Santos  
**Rascunho:** 21/11/2026  

Os exemplos de fala da cliente são fictícios.

**Como ler os termos.** O artigo é técnico, mas cada ideia aparece primeiro em português. Na primeira ocorrência, o jargão habitual vem entre parênteses. Depois disso, usamos a forma mais curta.

| Termo | Em português claro |
| --- | --- |
| **Modelo de linguagem** (LLM) | Programa que gera ou classifica texto a partir de exemplos |
| **Intenção** (*intent*) | O que a cliente quer naquele turno: marcar, perguntar preço, falar com alguém… |
| **Intenção fechada** | Pedido que o sistema já sabe tratar com resposta fixa do cadastro ou com um link |
| **Intenção aberta** | Pergunta fora do catálogo, que ainda precisa de prosa gerada e validada |
| **Léxico / regras** | Padrões baratos no código («quero marcar», «quanto custa») — sem chamar o modelo |
| **Classificador** | Modelo que só devolve um rótulo e um grau de confiança — não escreve a resposta |
| **Rotina de resposta** (*handler*) | Código que, dado o rótulo, monta a frase e o botão certos |
| **Redator** | Modelo de linguagem que **só redige** a resposta a perguntas abertas (fora do catálogo e das rotinas fixas). Não etiqueta intenção nem marca horários. |
| **Validador** | Verificação automática que rejeita texto inventado ou perigoso |
| **Recall** | Entre os casos que *deveriam* ser apanhados, quantos o sistema apanhou de facto |

---

## Resumo

O atendimento por WhatsApp numa clínica de estética não é uma conversa livre. Preço, política e perguntas frequentes têm de sair do cadastro da clínica. Marcar, remarcar e cancelar têm de ser acções auditáveis — ocupam sala, profissional e, por vezes, um sinal Pix. Um único modelo de linguagem que «percebe e responde» falha nestes invariantes: inventa horários, mistura botões e perde o facto que já estava escrito no catálogo.

Sistemas maduros de atendimento resolvem isto em camadas: regras baratas primeiro; depois um classificador que só etiqueta; depois rotinas fixas de resposta; e só no fim um **redator** — o modelo de linguagem que só redige respostas a perguntas abertas fora do catálogo e das rotinas fixas; não etiqueta intenção nem marca horários — com melhoria medida offline, sem o modelo «aprender sozinho» em produção.

É essa a arquitectura do Tredane. O chat informa e encaminha com o botão «Abrir agenda»; a página web da cliente é o único sítio onde se marca; cada clínica corre isolada na infraestrutura. Intenções fechadas (agenda, preço, equipe, FAQ de catálogo e FAQ institucional) nunca passam pelo redator: o servidor monta a frase a partir do cadastro ou do link. A telemetria de rótulos e o modo sombra fazem parte do desenho de melhoria contínua. A medição do léxico mostra a assimetria que justifica o classificador: quase nunca inventa um link de agenda, mas perde paráfrases — e é aí que a etiqueta recupera *sem* redigir.

---

## 1. O problema: WhatsApp de clínica e o falhanço do modelo livre

Uma clínica de estética recebe, no mesmo número, cumprimentos, pedidos de preço, «fazem [serviço X]?», «me mostra a agenda», pedidos de pessoa e dúvidas clínicas. O canal é a API oficial do WhatsApp Business. A cliente escreve como quiser. A clínica precisa de duas coisas ao mesmo tempo:

- respostas **factuais**, tiradas do cadastro;
- acções **determinísticas**, com efeito no estado operacional (compromisso, sala, profissional).

O atalho clássico — um modelo que interpreta a mensagem e escreve a resposta — falha por três motivos estruturais.

1. **Facto não é prosa.** Preço, duração, o que uma variante inclui, expediente e política de cancelamento vivem no cadastro. Se o modelo redige, inventa ou omite. Uma verificação depois do texto ajuda, mas não substitui a fonte.
2. **Acção não é conversa.** Marcar um horário muda o sistema. Texto livre nunca deveria autorizar essa mudança sozinho. No Tredane, a confirmação saiu do chat e passou a ser só na página da cliente.
3. **Paráfrase não é cobertura.** Regras e listas de palavras são precisas quando casam, mas perdem verbos novos («mostra a agenda», «fazem [serviço X]?»). Se a falha cair no redator, a cliente vê texto inventado, botões a mais ou passagem indevida à equipe — «horários livres», «mensagem anterior», emoji, ou o par Abrir agenda + Falar com a equipe na mesma mensagem.

Por isso, no atendimento automático, a mensagem normal à cliente é uma frase montada pelo servidor. O modelo só redige perguntas abertas fora do catálogo — com validação. Se falhar, sai uma frase fixa («não consegui entender…») e um alerta à equipe, sem desligar a assistência. O chat **não** marca, remarca nem cancela: só informa e encaminha.

O problema de engenharia deixa de ser «parecer humano» e passa a ser: **escolher a rotina certa** sem deixar o modelo escrever o que o cadastro já sabe.

---

## 2. Arquitectura de referência: compreensão por camadas

Atendimento orientado a tarefa — catálogo, perguntas frequentes e, por vezes, texto gerado — costuma seguir o mesmo esqueleto. Na indústria chama-se frequentemente *NLU* (*natural language understanding*): compreender a intenção da mensagem antes de decidir o que fazer.

```
segurança e pausas
  → regras / léxico              (barato, auditável, sem custo de modelo)
  → classificador de intenção    (rótulo + confiança; sem prosa)
  → rotinas de resposta          (uma por intenção fechada)
  → redator só para abertas      (com validação / ancoragem no cadastro)
  → ciclo de avaliação offline   (registo → amostra → rótulo → corpus → limiares)
  ✗ sem treino contínuo não supervisionado em produção
```

| Camada | O que faz | O que evita |
| --- | --- | --- |
| **Segurança** | Pedido para parar, temas sensíveis, aviso de que há IA | O classificador a reabrir ramos de risco |
| **Léxico / regras** | Casos óbvios; se o texto nomeia um serviço, pré-escolhe esse serviço | Chamar o modelo para «oi» ou «quanto custa a limpeza?» |
| **Classificador** | Uma etiqueta de um conjunto fechado, com confiança | Um modelo que decide *e* escreve na mesma chamada |
| **Rotina de resposta** | Frase constante + botão, a partir do cadastro ou do link | «Melhorar» a copy de um pedido já fechado com o modelo |
| **Redator (fallback)** | Só fora do conjunto fechado; sem silêncio se falhar | Usar prosa gerada como caminho normal de preço ou FAQ |
| **Avaliação offline** | Corpus rotulado, limiares por tipo de pedido, correcções de léxico com revisão | O sistema a «aprender» sozinho em produção e a derivar sem auditoria |

A literatura recente sobre avaliação de agentes reforça três hábitos: separar testes de regressão (não pode partir) de testes de capacidade (ainda falha e queremos medir); avaliar pelo **estado final** no sistema, não só pelo texto bonito; e ler erros antes de afinar o *prompt*. O classificador é um encaminhador, não um autor. Melhorar o sistema é um ciclo de medição, não um gradiente a correr em produção.

---

## 3. A arquitectura do Tredane

### 3.1 Três canais, papéis distintos

| Canal | Papel |
| --- | --- |
| **Chat WhatsApp** | Informar (catálogo, preço, horário, política, FAQ) e encaminhar |
| **Página web da cliente** | Agendar, remarcar, cancelar, ver marcações; confirmar na própria página |
| **Painel da clínica** | A equipe marca directamente; também pode enviar o link «Abrir agenda» |

«Abrir agenda» no chat é sempre um botão de ligação (URL) que abre a página inicial da cliente — próximas marcações e «Agendar novo». Excepção: remarcar ou cancelar podem abrir directamente nessa vista. Nunca o par Abrir agenda + Falar com a equipe na mesma bolha: a Meta não mistura bem esses tipos de botão, e a cliente fica com dois toques ou copy confusa.

### 3.2 O que acontece a cada mensagem

Depois das guardas de segurança (pausa da clínica, «parar», transparência sobre IA, temas sensíveis):

```
mensagem da cliente
  → [1] Léxico / regras
  → [2] Classificador — só se [1] não fechou o caso
       → { rótulo, confiança }; nunca escreve a resposta
  → [3] Rotina de resposta → frase + botão
  → [4] Só se aberta / confiança baixa / classificador falhou
       → redator + validador
```

O classificador devolve só o rótulo; o servidor monta a resposta. O conjunto de etiquetas é fechado e legível:

| Rótulo | Exemplos de fala | O que o servidor faz |
| --- | --- | --- |
| **Agenda** | «quero marcar», «tem vaga?», «me mostra a agenda» | Frase fixa + botão «Abrir agenda» (página inicial; se o léxico reconheceu um só serviço, o link pode abrir nesse serviço) |
| **Agenda + informação** (misto) | «quanto custa a limpeza e tem vaga amanhã?» | Responde à informação e junta «Abrir agenda» na mesma mensagem |
| **Remarcar** | «preciso mudar o dia», «quero remarcar» | Frase fixa + link para remarcar na página |
| **Cancelar** | «quero cancelar», «não vou poder ir» | Frase fixa + link para cancelar na página |
| **Preço** | «quanto custa [serviço X]?», «preço da depilação» | Preço / tabela do cadastro (+ «Abrir agenda» quando for um serviço) |
| **Equipe** | «quero falar com alguém», «chama a atendente» | Oferta de falar com a equipe (botão próprio) |
| **FAQ de catálogo** | «o que inclui?», «fazem [serviço X]?», expediente, política, localização | Texto do cadastro (serviço/variante) ou frase de «não tenho esse facto» |
| **FAQ institucional** | estacionamento, o que levar, pagamento no dia | Texto publicado pela clínica — sem paráfrase do modelo |
| **Fora deste conjunto** (abertas) | dúvida sem facto no cadastro, comparação subjectiva, etc. | **Redator** + validador — única via em que o modelo escreve prosa |

O léxico **pré-escolhe um serviço** quando o reconhece; o classificador **não** escolhe serviço. Na FAQ de catálogo, clarificação («o que inclui?») e oferta («fazem [serviço X]?») leem o mesmo cadastro: o sistema não inventa prosa.

Princípio estrutural: **nunca inventar um rótulo novo sem a rotina de resposta já ligada.** Etiquetar «FAQ de catálogo» sem o código a ler o cadastro devolveria o turno ao redator com a etiqueta «correcta» — e a cliente veria texto inventado.

### 3.3 Uma clínica, um isolamento

Cada clínica corre num *Durable Object* — uma unidade isolada na Cloudflare, com base SQLite própria para contactos, conversas, pipeline e agenda. Uma base central guarda contas, memberships, convites e suporte; anexos ficam em armazenamento privado. O modelo de perguntas abertas corre no Worker (função na borda) através de uma fila; o objecto da clínica guarda um instantâneo do contexto, reclama o resultado e aplica-o. «Um objecto por clínica» não basta sozinho: autorização na API, ligações em tempo real, filas e ficheiros têm de respeitar o mesmo limite entre clínicas.

### 3.4 Melhoria contínua sem auto-treino

O modelo não aprende sozinho em produção. O desenho de adaptação é:

```
turno
  → registo estruturado (rótulo, confiança, origem, rotina aplicada, desfecho)
  → amostra de erros (encaminhamento errado, redator indevido, fallback)
  → rotulação humana ou de laboratório
  → crescimento do corpus de testes
  → reavaliação de limiares e, se fizer sentido, do léxico ou do prompt
```

Opcionalmente, o **modo sombra** corre o classificador e regista o resultado *sem* alterar o que a cliente vê — útil para medir acordo entre etiqueta e rotina antes de mudar o tráfego. Métricas naturais deste ciclo: cobertura das intenções fechadas, precisão do rótulo, encaminhamento errado e redator indevido. Ao léxico sobem só padrões curtos e inequívocos (por exemplo «mostra / ver a agenda»); o classificador absorve o resto das paráfrases.

**Fora do desenho:** treino contínuo não supervisionado; treinar em texto livre da cliente sem base legal; busca semântica como substituto da detecção de intenção — até haver evidência em contrário.

---

## 4. Como medimos e o que aprendemos

### 4.1 Camadas de avaliação

Há uma metodologia de avaliação do atendimento conversacional. Certas regras binárias (*invariantes*) bloqueiam a entrada de código se forem violadas. Um quadro de pontuação de diálogos determinísticos (nível L1: o teste corre o diálogo sem chamar o modelo «ao vivo») compara cada alteração com uma linha de base. Quem muda o atendimento automático acrescenta um caso L1 por comportamento novo ou corrigido.

| Nível | Papel |
| --- | --- |
| Testes unitários / L1 | Regressão: o que já funcionava não pode partir |
| Corpus de intenção | Precisão e *recall* do léxico e do classificador |
| Laboratório | Conversa controlada num tenant de demonstração |
| Operação | Monitorização contínua (rótulos, desfechos, alertas) |

### 4.2 Medição de intenção (novembro de 2026)

Piso pessimista — corpus de 160 frases difíceis (paráfrases, gíria, informação que **não** deve virar link), escrito para stressar o léxico, não para estimar a taxa real da clínica:

| Métrica | Valor |
| --- | --- |
| *Recall* «há intenção de agenda» | **73 %** |
| Informação tratada como agenda (falso link) | **0 %** |
| Serviço pré-escolhido certo (quando o léxico escolhe) | **100 %** |
| *Recall* remarcar / cancelar / agendar (por classe) | 50 % / 69 % / 74 % |

Leitura: o léxico **não se engana** a mandar o link; **perde** paráfrases. Daí o classificador como segunda tentativa só de rótulo. Critério de qualidade que usamos neste eixo: *recall* combinado (léxico + classificador) elevado, informação→agenda perto de zero, zero regressões de segurança.

### 4.3 Casos que moldaram o desenho

| Caso | O que acontecia no anti-padrão | O que a arquitectura faz |
| --- | --- | --- |
| «Me mostra a agenda» | Redator inventava horários e botões | Léxico ou rótulo `agendar` → frase fixa + URL «Abrir agenda» |
| FAQ «o que inclui?» | Prosa inventada sobre a variante | Rotina lê o texto do cadastro (ou a frase de «não tenho esse facto») |
| «Fazem [serviço X]?» | Oferta tratada como pergunta aberta | Mesma família FAQ de catálogo — oferta e clarificação leem o cadastro |
| Tema sensível / pedido de pessoa | Classificador a competir com a segurança | Guardas prevalecem; o classificador **não** toca nesses ramos |

---

## 5. O que continua em discussão

Algumas escolhas de afinação — não de arquitectura — permanecem abertas:

| Pergunta | Nota |
| --- | --- |
| Qual modelo para o classificador (mais capaz vs mais barato)? | Custo por mensagem vs qualidade do rótulo |
| Limiar de confiança por tipo de pedido? | Agenda mais conservadora que FAQ, por exemplo |
| Manter a classe «misto» ou dois rótulos com junção no servidor? | Informação + agenda na mesma mensagem |
| Busca semântica para detectar intenção? | Fora do desenho actual até prova |

---

## 6. Veredicto

A arquitectura do Tredane alinha-se ao que a indústria usa em assistentes com catálogo: regras → classificador-rótulo → rotinas de resposta → redator só para abertas; isolamento por clínica; página web para mutações de agenda; telemetria e modo sombra no ciclo de melhoria; sem auto-treino em produção. O chat informa e encaminha; a página marca; o cadastro fala pelos factos. Não é um chat «inteligente» a improvisar — é um encaminhador disciplinado com prosa gerada só onde o catálogo não chega.
