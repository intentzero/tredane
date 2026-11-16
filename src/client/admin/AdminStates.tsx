import { EmptyState } from '../panel/states/StatusScreens'

/** Mesma tela para rota inexistente e para quem não é superadmin: não revela que `/admin` existe. */
export function AdminNotFound() {
  return (
    <EmptyState
      title="Página não encontrada"
      description="O endereço não existe ou foi movido."
      actionLabel="Ir para o início"
      onAction={() => window.location.assign('/clinicas')}
    />
  )
}
