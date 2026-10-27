# Política de Privacidade do Tredane

*English version: [Privacy Policy](/privacy)*

**Última atualização:** 27/10/2026 · **Vigência:** a partir da data de publicação

Esta política explica, em linguagem simples, como o Tredane trata dados pessoais, em conformidade com a Lei Geral de Proteção de Dados Pessoais (LGPD, Lei nº 13.709/2018), e como usamos os dados que recebemos da plataforma da Meta (WhatsApp Business Platform / Cloud API).

## 1. Quem somos

O Tredane é um serviço da Lucimark: uma plataforma (SaaS) que ajuda clínicas e estúdios a atender clientes pelo WhatsApp, marcar horários e cobrar sinal por Pix.

- **Empresa responsável:** LUCIMARK INOVA SIMPLES (I.S.), Brasil
- **CNPJ:** 66.552.736/0001-80
- **Endereço:** Condomínio Ouro Vermelho II nº 0, Setor Habitacional Jardim Botânico, Brasília-DF, CEP 71680-385
- **Contato para privacidade e proteção de dados:** [privacidade@tredane.com](mailto:privacidade@tredane.com)

## 2. Quem decide sobre os seus dados (papéis)

- **Se você é paciente ou cliente de uma clínica** que usa o Tredane (por exemplo, conversou com a clínica pelo WhatsApp ou marcou um horário): a **clínica é a controladora** dos seus dados — é ela quem decide para que eles servem. A **Lucimark atua como operadora**, tratando os dados em nome da clínica e conforme as instruções dela.
- **Se você é responsável ou atendente de uma clínica que usa o Tredane:** a **Lucimark é a controladora** dos seus dados de cadastro e acesso.
- **Se você visita o site tredane.com** ou nos escreve: a Lucimark é a controladora dos dados que você nos enviar.

O Tredane é operado pela Lucimark, sob o CNPJ da Lucimark.

## 3. Quais dados tratamos e onde ficam

**Pacientes e contatos das clínicas (recebidos pelo WhatsApp da clínica):**
- Número de WhatsApp (wa_id) e nome de perfil do WhatsApp (ou o nome informado na conversa);
- Conteúdo das mensagens enviadas e recebidas, data e hora, e situação de entrega (enviada, entregue, lida, falha);
- Anexos recebidos (imagens, PDFs e áudios), guardados em armazenamento privado;
- Agendamentos: serviço, data, horário, profissional e sala;
- Etapa de acompanhamento do atendimento definida pela clínica;
- Cobranças de sinal por Pix: valor, identificador da cobrança, situação (pendente, paga, expirada, estornada) e motivo de estorno, quando houver.

Em clínicas de estética, depilação e similares, as conversas podem mencionar procedimentos ou condições de pele ou de saúde. Reconhecemos que esses dados podem ser **dados pessoais sensíveis** de saúde (art. 5º, II, da LGPD) e os tratamos com base no art. 11 da LGPD, para a tutela da saúde e a execução do contrato com o paciente, com as medidas de segurança descritas abaixo.

**Usuários das clínicas (responsáveis e atendentes):**
- Nome, e-mail e dados de sessão e login, geridos pelo nosso provedor de autenticação (Clerk), incluindo verificação em duas etapas quando exigida;
- Vínculo com a clínica, papel e convites;
- Registros de auditoria (ações administrativas, pedidos e sessões de suporte, aprovações e horários);
- Inscrição para notificações no navegador (endereço técnico do navegador). Os avisos de nova conversa não incluem o texto da mensagem.

**Dados das clínicas:** nome da clínica, serviços, horários, profissionais, salas, dados do WhatsApp Business conectado e credenciais de integração (WhatsApp e Pix), guardadas de forma cifrada.

**Visitantes do site:** o site tredane.com não tem formulários nem ferramentas de rastreamento; se você nos escrever por e-mail, tratamos seu endereço e o conteúdo da mensagem.

**Onde ficam:** os dados de atendimento de cada clínica ficam num banco de dados isolado por clínica (Cloudflare Durable Objects); os anexos ficam num armazenamento privado separado por clínica (Cloudflare R2); os dados de cadastro, vínculo, conexão do WhatsApp e auditoria ficam num banco central (Cloudflare D1); eventos recebidos do WhatsApp passam por filas (Cloudflare Queues) apenas para processamento. Os registros técnicos de recebimento de webhooks não guardam o corpo da mensagem nem o telefone do contato.

## 4. Dados recebidos da plataforma da Meta (WhatsApp)

O Tredane se conecta ao WhatsApp Business da clínica pela plataforma oficial da Meta (WhatsApp Business Platform / Cloud API), com autorização da própria clínica. Por essa conexão recebemos:

- **Da conexão (Embedded Signup):** identificadores da conta WhatsApp Business (WABA) e do número, número exibido, nome verificado e um token de acesso, guardado cifrado e nunca mostrado no painel;
- **Dos webhooks:** mensagens recebidas (texto e anexos), número (wa_id) e nome de perfil de quem escreve, e atualizações de entrega e leitura das mensagens enviadas pela clínica;
- **Modelos de mensagem** aprovados pela Meta para a conta da clínica.

**Como usamos esses dados:** apenas para prestar o serviço à clínica — mostrar as conversas à equipe da clínica, enviar as respostas dela, marcar horários e cobrar sinal. **Não vendemos** dados, **não os usamos para publicidade**, não criamos perfis para terceiros e não compartilhamos dados de uma clínica com outra. O uso segue os Termos e Políticas do WhatsApp Business e de Mensagens Comerciais da Meta: a clínica deve ter permissão para contatar seus clientes, mensagens iniciadas pela clínica fora da janela de atendimento usam modelos aprovados pela Meta, e você pode pedir para parar de receber mensagens a qualquer momento. A Meta também trata dados conforme a política de privacidade dela.

## 5. Para que usamos e com qual base legal

| Finalidade | Base legal (LGPD) |
| --- | --- |
| Receber e enviar mensagens de WhatsApp em nome da clínica | Definida pela clínica, como controladora; em regra, execução de contrato ou procedimentos preliminares (art. 7º, V) |
| Marcar, alterar e lembrar agendamentos | Execução de contrato (art. 7º, V) |
| Gerar cobrança de sinal por Pix e conciliar o pagamento | Execução de contrato (art. 7º, V) |
| Sugestões de resposta por IA para a equipe da clínica (sempre revisadas por uma pessoa antes do envio) | Legítimo interesse (art. 7º, IX), sempre com revisão humana |
| Criar e manter contas de usuários das clínicas, convites e login | Execução de contrato (art. 7º, V) |
| Segurança, auditoria, suporte e prevenção a fraudes | Legítimo interesse (art. 7º, IX) e cumprimento de obrigação legal (art. 7º, II) |
| Responder contatos pelo site ou por e-mail | Legítimo interesse (art. 7º, IX) |

Quando houver dados sensíveis de saúde, o tratamento se baseia no art. 11 da LGPD: tutela da saúde (art. 11, II, "f") e execução do contrato com o paciente (art. 11, II, "g", e art. 7º, V).

## 6. Com quem compartilhamos (suboperadores)

Não vendemos dados pessoais. Compartilhamos dados apenas com os fornecedores necessários para o serviço funcionar:

| Fornecedor | Para quê | Dados envolvidos |
| --- | --- | --- |
| **Meta Platforms (WhatsApp Business Platform / Cloud API)** | Envio e recebimento de mensagens | Número, nome de perfil, mensagens, anexos e situação de entrega |
| **Cloudflare** | Hospedagem (Workers), bancos de dados (D1 e Durable Objects), armazenamento de anexos (R2), filas (Queues) e registros técnicos | Todos os dados do serviço |
| **Clerk** | Login e autenticação de usuários das clínicas | Nome, e-mail e sessão de usuários das clínicas (nenhum dado de pacientes) |
| **Anthropic (via Cloudflare AI Gateway)** | Sugestões de resposta por IA, **somente se a clínica optar por ativá-las** | Mensagens recentes da conversa, primeiro nome do cliente, catálogo de serviços e etapa do atendimento; nunca telefone nem anexos. O conteúdo não é armazenado e não é usado para treinar modelos. |
| **Woovi / OpenPix** | Cobranças Pix na conta da própria clínica (o Tredane não recebe nem repassa dinheiro) | Valor, identificador e situação da cobrança |
| **Cloudflare (Email Sending)** | Convites e avisos por e-mail | Nome e e-mail de usuários das clínicas |
| Serviços de push do navegador (Apple, Google, Mozilla) | Entregar notificações no navegador do usuário | Endereço técnico da inscrição; sem texto de mensagem |

Também podemos compartilhar dados quando exigido por lei ou por ordem de autoridade competente.

## 7. Transferência internacional

Alguns fornecedores (Cloudflare, Meta, Clerk, serviços de push do navegador e, quando ativada pela clínica, Anthropic) podem tratar dados fora do Brasil, nos Estados Unidos e na União Europeia. Nesses casos, adotamos as garantias previstas no art. 33 da LGPD, por meio das cláusulas contratuais padrão oferecidas por esses fornecedores.

## 8. Por quanto tempo guardamos

- **Dados de atendimento** (contatos, conversas, anexos, agendamentos): enquanto a clínica for cliente do Tredane, ou até a clínica excluir o contato.
- **Exclusão de um contato pela clínica:** apagamos imediatamente mensagens, anexos, conversas, sugestões de IA e oportunidades daquele contato. Os agendamentos ficam apenas de forma anonimizada ("Contacto removido") e as cobranças Pix perdem o vínculo com o contato. Mantemos só um marcador técnico do número para impedir que o contato seja recriado automaticamente por mensagens antigas reenviadas.
- **Encerramento da conta da clínica:** exclusão total dos dados da clínica em até **30 dias**, incluindo anexos, banco de dados da clínica, notificações e acessos.
- **Registros de auditoria** (sem conteúdo de mensagens) e **logs técnicos**: 6 meses, conforme o Marco Civil da Internet (Lei nº 12.965/2014).
- **Registros de cobrança**: 5 anos, para cumprimento de obrigações legais e fiscais.

Veja como pedir a exclusão em [Instruções para exclusão de dados](/eliminacao-de-dados).

## 9. Segurança

Adotamos medidas técnicas e administrativas como: separação dos dados de cada clínica; anexos em armazenamento privado, com links de download temporários; credenciais de integração (WhatsApp e Pix) cifradas; verificação de assinatura dos webhooks; controle de acesso por papel e verificação em duas etapas para papéis sensíveis; logs sem conteúdo de mensagens nem tokens; e acesso do suporte da Lucimark **somente com aprovação do responsável da clínica**, por sessão limitada a 30 minutos e com registro de auditoria. Nenhum sistema é totalmente imune a falhas; em caso de incidente relevante, comunicaremos a ANPD e os titulares conforme a LGPD.

## 10. Seus direitos

Pelo art. 18 da LGPD, você pode pedir: confirmação de que tratamos seus dados; acesso; correção de dados incompletos, inexatos ou desatualizados; anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desacordo com a lei; portabilidade; eliminação de dados tratados com consentimento; informação sobre com quem compartilhamos; informação sobre a possibilidade de não consentir e suas consequências; e revogação do consentimento. Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).

**Como exercer:**
- **Paciente ou cliente de uma clínica:** você pode falar diretamente com a clínica, que é a controladora, ou escrever para [privacidade@tredane.com](mailto:privacidade@tredane.com). Nesse caso, encaminharemos o pedido à clínica e a apoiaremos na resposta.
- **Usuário de clínica ou visitante do site:** escreva para [privacidade@tredane.com](mailto:privacidade@tredane.com).

Responderemos em até **15 dias**. Podemos pedir informações para confirmar sua identidade.

## 11. Cookies

O site tredane.com **não usa cookies de análise, publicidade nem ferramentas de rastreamento**, e as fontes são servidas pelo próprio site. O painel das clínicas usa apenas cookies e armazenamento estritamente necessários para login, segurança e sessões de suporte.

## 12. Crianças e adolescentes

O Tredane é destinado a clínicas e estúdios e aos seus usuários adultos. Não coletamos intencionalmente dados de crianças. Se uma clínica atender menores, cabe a ela, como controladora, observar o art. 14 da LGPD (incluindo o consentimento de um dos pais ou responsável, quando aplicável).

## 13. Alterações desta política

Podemos atualizar esta política. A versão vigente estará sempre em tredane.com/privacidade, com a data de atualização. Mudanças relevantes serão comunicadas às clínicas-clientes.

## 14. Contato e encarregado

**Contato para privacidade:** [privacidade@tredane.com](mailto:privacidade@tredane.com)
**Encarregado (DPO):** Paulo Santos · [privacidade@tredane.com](mailto:privacidade@tredane.com)
