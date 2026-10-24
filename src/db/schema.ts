import { integer, primaryKey, sqliteTable, text, index } from 'drizzle-orm/sqlite-core'

/**
 * F0: entidades sintéticas para exercitar D1, Drizzle e fronteiras de tenant.
 * O domínio operacional definitivo vive no SQLite do DO (DEC-038); este schema
 * D1 cobre administração mínima. Campos finais sujeitos a docs de produto/ADRs.
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

/** Memberships N:N no D1 central (Confirmado, DEC-038). Sem Clerk Organizations. */
export const tenantMemberships = sqliteTable('tenant_memberships', {
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  clerkUserId: text('clerk_user_id').notNull(),
  role: text('role', { enum: ['owner', 'attendant'] }).notNull(),
  status: text('status', { enum: ['active', 'revoked'] }).notNull().default('active'),
  createdAt: integer('created_at').notNull(),
  revokedAt: integer('revoked_at'),
}, (table) => [
  primaryKey({ columns: [table.tenantId, table.clerkUserId] }),
  index('tenant_memberships_user_idx').on(table.clerkUserId),
  index('tenant_memberships_tenant_status_idx').on(table.tenantId, table.status),
])
