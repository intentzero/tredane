# Modelos de mensagem (utility) — reserva por bloco

> **Status: rascunho. NÃO submetidos à Meta.** Só devem ser enviados para aprovação
> depois de revisão do Paulo. Enquanto não houver modelo aprovado, o app só envia
> as mensagens da reserva por bloco **dentro da janela de 24 h** (texto livre); fora
> dela, mostra o aviso e oferece «Copiar texto».

Categoria: **UTILITY** · Idioma: **pt_BR** · Sem botões, sem mídia.

> **Mudança de 27/10/2026 (decisão do Paulo):** a reserva por bloco tem **sempre hora**.
> A etapa «A definir», o vencimento do bloco e os avisos foram removidos (migração 18).
> O antigo modelo 1 (`reserva_bloco_confirmacao`, «hora exata depois») ficou obsoleto
> e foi retirado. Resta só o modelo abaixo. O horário vai no fuso configurado da
> clínica (padrão Brasília). A confirmação da resposta da paciente continua manual.

## `reserva_bloco_hora_confirmada` — horário reservado

Enviada em «Reservar bloco» → «Reservar e avisar paciente» (o horário livre é obrigatório; o compromisso ocupa a duração do bloco).

```
Olá, {{1}}! Seu horário está confirmado.
{{2}} — {{3}}, às {{4}} (até {{5}})
Com {{6}}
Se precisar remarcar, é só responder esta mensagem.
```

| Variável | Exemplo | Origem |
|---|---|---|
| `{{1}}` | Marina | primeiro nome do contato |
| `{{2}}` | Preenchimento labial | procedimento |
| `{{3}}` | terça, 3/11 | dia |
| `{{4}}` | 10:00 | início |
| `{{5}}` | 11:00 | fim |
| `{{6}}` | Dra. Ana | profissional (e sala, se houver) |

## Observações

- No app, os textos livres (dentro das 24 h) usam emojis (✅, 💙); nos modelos para a
  Meta eles foram retirados para reduzir o risco de reclassificação como MARKETING.
- Código dos textos livres: `src/client/panel/screens/holds/holdFormat.ts`.
