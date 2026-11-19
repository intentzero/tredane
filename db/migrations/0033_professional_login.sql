-- DEC-204: papel professional no painel e vínculo da ficha de agenda ao login.
-- SQLite não altera CHECK — rebuild das tabelas de membership e convite.

PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `tenant_memberships_v33` (
  tenant_id TEXT NOT NULL,
  clerk_user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'attendant', 'professional')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY (tenant_id, clerk_user_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `tenant_memberships_v33` (
  tenant_id, clerk_user_id, role, status, created_at, revoked_at
)
SELECT tenant_id, clerk_user_id, role, status, created_at, revoked_at
FROM tenant_memberships;
--> statement-breakpoint
DROP TABLE tenant_memberships;
--> statement-breakpoint
ALTER TABLE `tenant_memberships_v33` RENAME TO tenant_memberships;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tenant_memberships_user_idx ON tenant_memberships(clerk_user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tenant_memberships_tenant_status_idx ON tenant_memberships(tenant_id, status);
--> statement-breakpoint
CREATE TABLE `tenant_invitations_v33` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`normalized_email` text NOT NULL,
	`role` text DEFAULT 'attendant' NOT NULL CHECK (`role` IN ('owner', 'attendant', 'professional')),
	`issued_by_clerk_user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL CHECK (`status` IN ('pending', 'accepted', 'cancelled', 'expired')),
	`issued_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`accepted_by_clerk_user_id` text,
	`cancelled_at` integer,
	`cancelled_by_clerk_user_id` text,
	`last_resent_at` integer,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `tenant_invitations_v33` (
	`id`, `tenant_id`, `normalized_email`, `role`, `issued_by_clerk_user_id`, `token_hash`,
	`status`, `issued_at`, `expires_at`, `accepted_at`, `accepted_by_clerk_user_id`,
	`cancelled_at`, `cancelled_by_clerk_user_id`, `last_resent_at`
)
SELECT
	`id`, `tenant_id`, `normalized_email`, `role`, `issued_by_clerk_user_id`, `token_hash`,
	`status`, `issued_at`, `expires_at`, `accepted_at`, `accepted_by_clerk_user_id`,
	`cancelled_at`, `cancelled_by_clerk_user_id`, `last_resent_at`
FROM `tenant_invitations`;
--> statement-breakpoint
DROP TABLE `tenant_invitations`;
--> statement-breakpoint
ALTER TABLE `tenant_invitations_v33` RENAME TO `tenant_invitations`;
--> statement-breakpoint
CREATE INDEX `tenant_invitations_tenant_email_idx` ON `tenant_invitations` (`tenant_id`,`normalized_email`);
--> statement-breakpoint
CREATE INDEX `tenant_invitations_tenant_status_idx` ON `tenant_invitations` (`tenant_id`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_invitations_token_hash_uidx` ON `tenant_invitations` (`token_hash`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS professional_logins (
  tenant_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  normalized_email TEXT NOT NULL,
  clerk_user_id TEXT,
  also_attendant INTEGER NOT NULL DEFAULT 0 CHECK (also_attendant IN (0, 1)),
  PRIMARY KEY (tenant_id, resource_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS professional_logins_email_uidx
  ON professional_logins (tenant_id, normalized_email);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS professional_logins_user_uidx
  ON professional_logins (tenant_id, clerk_user_id)
  WHERE clerk_user_id IS NOT NULL;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
UPDATE `admin_schema_state` SET `version` = 24, `applied_at` = 0 WHERE `id` = 1;
