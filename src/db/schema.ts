import { integer, primaryKey, sqliteTable, text, index } from 'drizzle-orm/sqlite-core'

/**
 * F0: apenas entidades sintéticas para exercitar D1, Drizzle e fronteiras de tenant.
 * O domínio final permanece sujeito à documentação de produto e às ADRs.
 */
export const tenants = sqliteTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('America/Sao_Paulo'),
  createdAt: integer('created_at').notNull(),
})

export const services = sqliteTable('services', {
  id: text('id').notNull(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.id] }),
  index('services_tenant_idx').on(table.tenantId),
])

export const professionals = sqliteTable('professionals', {
  id: text('id').notNull(),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.id] }),
  index('professionals_tenant_idx').on(table.tenantId),
])
