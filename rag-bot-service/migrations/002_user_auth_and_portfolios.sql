-- Migration 002: User Password Authentication & Portfolio URL Integration

-- Add password authentication columns to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS salt VARCHAR(64);

-- Add portfolio URL to entities
ALTER TABLE entities ADD COLUMN IF NOT EXISTS portfolio_url VARCHAR(1024);
CREATE INDEX IF NOT EXISTS idx_entities_portfolio_url ON entities(portfolio_url);
CREATE INDEX IF NOT EXISTS idx_entities_tenant_url ON entities(tenant_id, portfolio_url);

