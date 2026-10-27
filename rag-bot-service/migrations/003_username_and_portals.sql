-- Migration 003: User Username & Portal Terminology Support

-- Add username column to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users(LOWER(username)) WHERE username IS NOT NULL;

-- Add portal_url to entities (alias and modern standard for portfolio_url)
ALTER TABLE entities ADD COLUMN IF NOT EXISTS portal_url VARCHAR(1024);
UPDATE entities SET portal_url = portfolio_url WHERE portal_url IS NULL AND portfolio_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_entities_portal_url ON entities(portal_url);
CREATE INDEX IF NOT EXISTS idx_entities_tenant_portal_url ON entities(tenant_id, portal_url);

