-- F0: memberships sintéticos no D1 central (DEC-038). IDs e e-mails são fictícios.
-- Não usar estes valores em deploy remoto nem com dados reais.
CREATE TABLE IF NOT EXISTS tenant_memberships (
  tenant_id TEXT NOT NULL,
  clerk_user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'attendant')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY (tenant_id, clerk_user_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS tenant_memberships_user_idx ON tenant_memberships(clerk_user_id);
CREATE INDEX IF NOT EXISTS tenant_memberships_tenant_status_idx ON tenant_memberships(tenant_id, status);
