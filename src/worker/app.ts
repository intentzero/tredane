import { Hono } from 'hono'

export type WorkerBindings = {
  DB: D1Database
}

export const app = new Hono<{ Bindings: WorkerBindings }>()

// Endpoint técnico público: jamais devolver detalhes de tenant, segredos ou dados pessoais.
app.get('/api/health', (c) => {
  c.header('Cache-Control', 'no-store')
  return c.json({ status: 'ok', service: 'tredane', phase: 'f0' })
})

app.notFound((c) => c.json({ error: 'not_found' }, 404))
