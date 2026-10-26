import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { env } from '../../config/env.js';
import { logger } from '../../shared/logger.js';

const { Client } = pg;

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Apply pending SQL schema migrations idempotently using a tracking table.
 */
export async function applyMigrations(client: pg.Client | pg.PoolClient): Promise<MigrationResult> {
  // 1. Ensure schema_migrations tracking table exists
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const migrationsDir = path.resolve(process.cwd(), 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    logger.warn(`Migrations directory not found at ${migrationsDir}`);
    return { applied: [], skipped: [] };
  }

  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  // 2. Fetch already applied versions
  const appliedRes = await client.query('SELECT version FROM schema_migrations');
  const appliedSet = new Set(appliedRes.rows.map(r => r.version));

  // If tracking table was just created but database already has tables from a previous setup,
  // register existing migration files to prevent re-running already applied DDL.
  if (appliedSet.size === 0) {
    const tableCheck = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='tenants'"
    );
    if (tableCheck.rows.length > 0) {
      for (const file of migrationFiles) {
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING',
          [file]
        );
        appliedSet.add(file);
      }
      logger.info(
        `Discovered existing schema. Registered ${migrationFiles.length} migration(s) in schema_migrations table.`
      );
      return { applied: [], skipped: migrationFiles };
    }
  }

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of migrationFiles) {
    if (appliedSet.has(file)) {
      skipped.push(file);
      continue;
    }

    const fullPath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(fullPath, 'utf-8');
    logger.info(`Applying migration: ${file}...`);

    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      await client.query('COMMIT');
      applied.push(file);
      logger.info(`Successfully applied migration: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error(`Failed to apply migration: ${file}`, err);
      throw err;
    }
  }

  if (applied.length === 0) {
    logger.info(`Database schema is up to date (${skipped.length} migrations recorded).`);
  } else {
    logger.info(`Applied ${applied.length} new migration(s) successfully.`);
  }

  return { applied, skipped };
}

export async function runMigrations(): Promise<void> {
  if (!env.DATABASE_URL) {
    logger.info('No DATABASE_URL configured. Skipping PostgreSQL migration (Memory mode active).');
    return;
  }

  const client = new Client({
    connectionString: env.DATABASE_URL,
    ssl: env.DB_USE_SSL ? { rejectUnauthorized: false } : false,
  });

  try {
    await client.connect();
    logger.info('Checking database migrations...');
    await applyMigrations(client);
  } catch (err) {
    logger.error('Failed to run migrations:', err);
    throw err;
  } finally {
    await client.end();
  }
}

// Allow direct CLI execution
if (typeof import.meta !== 'undefined' && import.meta?.url && import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
