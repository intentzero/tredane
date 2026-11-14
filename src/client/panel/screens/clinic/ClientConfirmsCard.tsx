/**
 * M-74 (DEC-060, DEC-061): o cartão que diz como a marcação automática acontece.
 * Só leitura: não cria controlo; o interruptor que pausa fica em «Limites das automações».
 */
export function ClientConfirmsCard() {
  return (
    <section className="panel-card" aria-labelledby="client-confirms-t">
      <h2 id="client-confirms-t" className="panel-title-md">
        A cliente confirma o horário no WhatsApp
      </h2>
      <p className="panel-muted-sm">
        Só marca quando ela toca no botão da proposta. Mudar e cancelar continuam com a equipe.
      </p>
    </section>
  )
}
