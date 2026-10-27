import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { IDatabaseAdapter } from './database.interface.js';
import { applyMigrations } from './migrate.js';
import {
  Tenant,
  User,
  TenantMembership,
  Entity,
  EntityMembership,
  Document,
  DocumentVersion,
  DocumentChunk,
  IngestionJob,
  IngestionJobDocument,
  Conversation,
  Message,
  AnswerCitation,
  ScoredChunk,
} from '../../types/index.js';
import { logger } from '../../shared/logger.js';
import { generateUuid } from '../../shared/utils.js';

const { Pool } = pg;

function isValidUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function maskDbUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.username || 'user'}:***@${u.host}${u.pathname}`;
  } catch {
    return 'invalid-url';
  }
}

export class PostgresDatabaseAdapter implements IDatabaseAdapter {
  private pool: pg.Pool;
  private hasVector = false;
  private connectionString: string;

  constructor(connectionString: string, maxPool = 10, useSsl = false) {
    this.connectionString = connectionString;
    this.pool = new Pool({
      connectionString,
      max: maxPool,
      ssl: useSsl ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
      statement_timeout: 30000,
    });
  }

  async init(): Promise<void> {
    const masked = maskDbUrl(this.connectionString);
    logger.info(`[DB_INIT] Connecting to PostgreSQL at ${masked} (timeout: 5000ms)...`);
    let client: pg.PoolClient;
    try {
      client = await this.pool.connect();
    } catch (connErr: any) {
      logger.error(`[DB_INIT_ERROR] Could not establish connection to ${masked}: ${connErr?.message || connErr}`);
      logger.error(`[DB_INIT_ERROR] Diagnostics: Ensure database is running, the port/tunnel (e.g. localto.net) is active, and firewall permits traffic.`);
      throw connErr;
    }

    try {
      logger.info(`[DB_INIT] Acquired client. Testing with SELECT 1...`);
      await client.query('SELECT 1');

      // Idempotent migration check: uses schema_migrations tracking table
      logger.info(`[DB_INIT] Checking and applying migrations if pending...`);
      await applyMigrations(client);

      const vRes = await client.query("SELECT 1 FROM pg_extension WHERE extname = 'vector'");
      this.hasVector = vRes.rows.length > 0;
      logger.info(`[DB_INIT_SUCCESS] Connected to PostgreSQL database (pgvector active: ${this.hasVector})`);
    } catch (queryErr: any) {
      logger.error(`[DB_INIT_ERROR] Error running init queries on ${masked}:`, queryErr);
      throw queryErr;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  // Tenants
  async getTenantById(id: string): Promise<Tenant | null> {
    if (!isValidUuid(id)) return null;
    const res = await this.pool.query('SELECT * FROM tenants WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async createTenant(data: { id?: string; name: string; slug: string }): Promise<Tenant> {
    const id = data.id && isValidUuid(data.id) ? data.id : generateUuid();
    const res = await this.pool.query(
      `INSERT INTO tenants (id, name, slug)
       VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         updated_at = NOW()
       RETURNING *`,
      [id, data.name, data.slug]
    );
    const r = res.rows[0];
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  // Users & Memberships
  async getUserById(id: string): Promise<User | null> {
    if (!isValidUuid(id)) return null;
    const res = await this.pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      email: r.email,
      name: r.name,
      username: r.username,
      passwordHash: r.password_hash,
      salt: r.salt,
      isSuperadmin: r.is_superadmin,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const res = await this.pool.query(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1) OR (username IS NOT NULL AND LOWER(username) = LOWER($1)) LIMIT 1',
      [email.trim()]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      email: r.email,
      name: r.name,
      username: r.username,
      passwordHash: r.password_hash,
      salt: r.salt,
      isSuperadmin: r.is_superadmin,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async getUserByUsername(username: string): Promise<User | null> {
    const res = await this.pool.query(
      'SELECT * FROM users WHERE username IS NOT NULL AND LOWER(username) = LOWER($1) LIMIT 1',
      [username.trim()]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      email: r.email,
      name: r.name,
      username: r.username,
      passwordHash: r.password_hash,
      salt: r.salt,
      isSuperadmin: r.is_superadmin,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async getUserByIdentifier(identifier: string): Promise<User | null> {
    const clean = identifier.trim().toLowerCase();
    const res = await this.pool.query(
      'SELECT * FROM users WHERE LOWER(email) = $1 OR (username IS NOT NULL AND LOWER(username) = $1) LIMIT 1',
      [clean]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      email: r.email,
      name: r.name,
      username: r.username,
      passwordHash: r.password_hash,
      salt: r.salt,
      isSuperadmin: r.is_superadmin,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async createUser(data: { id?: string; email: string; name: string; username?: string; passwordHash?: string; salt?: string; isSuperadmin?: boolean }): Promise<User> {
    const id = data.id && isValidUuid(data.id) ? data.id : generateUuid();
    const cleanUsername = data.username?.trim().toLowerCase() || null;
    const res = await this.pool.query(
      `INSERT INTO users (id, email, name, username, password_hash, salt, is_superadmin)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name,
         username = COALESCE(EXCLUDED.username, users.username),
         password_hash = COALESCE(EXCLUDED.password_hash, users.password_hash),
         salt = COALESCE(EXCLUDED.salt, users.salt),
         is_superadmin = EXCLUDED.is_superadmin,
         updated_at = NOW()
       RETURNING *`,
      [id, data.email, data.name, cleanUsername, data.passwordHash || null, data.salt || null, !!data.isSuperadmin]
    );
    const r = res.rows[0];
    return {
      id: r.id,
      email: r.email,
      name: r.name,
      username: r.username,
      passwordHash: r.password_hash,
      salt: r.salt,
      isSuperadmin: r.is_superadmin,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async getTenantMembership(tenantId: string, userId: string): Promise<TenantMembership | null> {
    if (!isValidUuid(tenantId) || !isValidUuid(userId)) return null;
    const res = await this.pool.query(
      'SELECT * FROM tenant_memberships WHERE tenant_id = $1 AND user_id = $2',
      [tenantId, userId]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      userId: r.user_id,
      role: r.role,
      createdAt: r.created_at,
    };
  }

  async getUserTenantMembership(userId: string): Promise<TenantMembership | null> {
    if (!isValidUuid(userId)) return null;
    const res = await this.pool.query(
      'SELECT * FROM tenant_memberships WHERE user_id = $1 LIMIT 1',
      [userId]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      userId: r.user_id,
      role: r.role,
      createdAt: r.created_at,
    };
  }

  async createTenantMembership(tenantId: string, userId: string, role: 'owner' | 'admin' | 'member' | 'viewer'): Promise<TenantMembership> {
    const id = generateUuid();
    const res = await this.pool.query(
      `INSERT INTO tenant_memberships (id, tenant_id, user_id, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role
       RETURNING *`,
      [id, tenantId, userId, role]
    );
    const r = res.rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      userId: r.user_id,
      role: r.role,
      createdAt: r.created_at,
    };
  }

  // Entities & Portals
  async getEntityById(tenantId: string, entityId: string): Promise<Entity | null> {
    if (!isValidUuid(tenantId) || !isValidUuid(entityId)) return null;
    const res = await this.pool.query(
      'SELECT * FROM entities WHERE tenant_id = $1 AND id = $2',
      [tenantId, entityId]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      portalUrl: r.portal_url || r.portfolio_url,
      portfolioUrl: r.portfolio_url || r.portal_url,
      isPublic: r.is_public,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async getEntityByPortfolioUrl(portfolioUrl: string): Promise<Entity | null> {
    const res = await this.pool.query(
      'SELECT * FROM entities WHERE LOWER(portfolio_url) = LOWER($1) OR LOWER(portal_url) = LOWER($1) LIMIT 1',
      [portfolioUrl]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      portalUrl: r.portal_url || r.portfolio_url,
      portfolioUrl: r.portfolio_url || r.portal_url,
      isPublic: r.is_public,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async getEntityByPortalUrl(portalUrl: string): Promise<Entity | null> {
    return this.getEntityByPortfolioUrl(portalUrl);
  }

  async getEntityByReference(tenantId: string, reference: string): Promise<Entity | null> {
    const res = await this.pool.query(
      `SELECT * FROM entities 
       WHERE tenant_id = $1 
         AND (id::text = $2 OR LOWER(slug) = LOWER($2) OR LOWER(portfolio_url) = LOWER($2) OR LOWER(portal_url) = LOWER($2))
       LIMIT 1`,
      [tenantId, reference]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      portalUrl: r.portal_url || r.portfolio_url,
      portfolioUrl: r.portfolio_url || r.portal_url,
      isPublic: r.is_public,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async getEntitiesByTenant(tenantId: string): Promise<Entity[]> {
    if (!isValidUuid(tenantId)) return [];
    const res = await this.pool.query('SELECT * FROM entities WHERE tenant_id = $1 ORDER BY name ASC', [tenantId]);
    return res.rows.map(r => ({
      id: r.id,
      tenantId: r.tenant_id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      portalUrl: r.portal_url || r.portfolio_url,
      portfolioUrl: r.portfolio_url || r.portal_url,
      isPublic: r.is_public,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async createEntity(data: { id?: string; tenantId: string; name: string; slug: string; description?: string; portalUrl?: string; portfolioUrl?: string; isPublic?: boolean }): Promise<Entity> {
    const id = data.id && isValidUuid(data.id) ? data.id : generateUuid();
    const url = data.portalUrl || data.portfolioUrl || null;
    const res = await this.pool.query(
      `INSERT INTO entities (id, tenant_id, name, slug, description, portal_url, portfolio_url, is_public)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tenant_id, slug) DO UPDATE SET
         name = EXCLUDED.name,
         description = COALESCE(EXCLUDED.description, entities.description),
         portal_url = COALESCE(EXCLUDED.portal_url, entities.portal_url),
         portfolio_url = COALESCE(EXCLUDED.portfolio_url, entities.portfolio_url),
         is_public = EXCLUDED.is_public,
         updated_at = NOW()
       RETURNING *`,
      [id, data.tenantId, data.name, data.slug, data.description || null, url, url, data.isPublic ?? false]
    );
    const r = res.rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      portalUrl: r.portal_url || r.portfolio_url,
      portfolioUrl: r.portfolio_url || r.portal_url,
      isPublic: r.is_public,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async deleteEntity(tenantId: string, entityId: string): Promise<boolean> {
    if (!isValidUuid(tenantId) || !isValidUuid(entityId)) return false;
    const res = await this.pool.query(
      'DELETE FROM entities WHERE tenant_id = $1 AND id = $2',
      [tenantId, entityId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async getEntityMembership(tenantId: string, entityId: string, userId: string): Promise<EntityMembership | null> {
    if (!isValidUuid(tenantId) || !isValidUuid(entityId) || !isValidUuid(userId)) return null;
    const res = await this.pool.query(
      'SELECT * FROM entity_memberships WHERE tenant_id = $1 AND entity_id = $2 AND user_id = $3',
      [tenantId, entityId, userId]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      entityId: r.entity_id,
      userId: r.user_id,
      role: r.role,
      createdAt: r.created_at,
    };
  }

  // Documents
  async getDocumentById(tenantId: string, entityId: string, documentId: string): Promise<Document | null> {
    if (!isValidUuid(tenantId) || !isValidUuid(entityId) || !isValidUuid(documentId)) return null;
    const res = await this.pool.query(
      'SELECT * FROM documents WHERE tenant_id = $1 AND entity_id = $2 AND id = $3',
      [tenantId, entityId, documentId]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      entityId: r.entity_id,
      originalFilename: r.original_filename,
      mimeType: r.mime_type,
      sizeBytes: Number(r.size_bytes),
      contentHash: r.content_hash,
      objectKey: r.object_key,
      isPublic: r.is_public,
      status: r.status,
      errorMessage: r.error_message,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async getDocumentByHash(entityId: string, contentHash: string): Promise<Document | null> {
    if (!isValidUuid(entityId)) return null;
    const res = await this.pool.query(
      'SELECT * FROM documents WHERE entity_id = $1 AND content_hash = $2',
      [entityId, contentHash]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      entityId: r.entity_id,
      originalFilename: r.original_filename,
      mimeType: r.mime_type,
      sizeBytes: Number(r.size_bytes),
      contentHash: r.content_hash,
      objectKey: r.object_key,
      isPublic: r.is_public,
      status: r.status,
      errorMessage: r.error_message,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async getDocumentsByEntity(tenantId: string, entityId: string): Promise<Document[]> {
    if (!isValidUuid(tenantId) || !isValidUuid(entityId)) return [];
    const res = await this.pool.query(
      'SELECT * FROM documents WHERE tenant_id = $1 AND entity_id = $2 ORDER BY created_at DESC',
      [tenantId, entityId]
    );
    return res.rows.map(r => ({
      id: r.id,
      tenantId: r.tenant_id,
      entityId: r.entity_id,
      originalFilename: r.original_filename,
      mimeType: r.mime_type,
      sizeBytes: Number(r.size_bytes),
      contentHash: r.content_hash,
      objectKey: r.object_key,
      isPublic: r.is_public,
      status: r.status,
      errorMessage: r.error_message,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async getDocumentCountByEntity(tenantId: string, entityId: string): Promise<number> {
    if (!isValidUuid(tenantId) || !isValidUuid(entityId)) return 0;
    const res = await this.pool.query(
      'SELECT COUNT(*)::int AS count FROM documents WHERE tenant_id = $1 AND entity_id = $2',
      [tenantId, entityId]
    );
    return res.rows[0]?.count ? Number(res.rows[0].count) : 0;
  }

  async createDocument(data: {
    id?: string;
    tenantId: string;
    entityId: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    contentHash: string;
    objectKey: string;
    isPublic?: boolean;
    status?: Document['status'];
  }): Promise<Document> {
    const id = data.id && isValidUuid(data.id) ? data.id : generateUuid();
    const res = await this.pool.query(
      `INSERT INTO documents (id, tenant_id, entity_id, original_filename, mime_type, size_bytes, content_hash, object_key, is_public, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (entity_id, content_hash) DO UPDATE SET
         original_filename = EXCLUDED.original_filename,
         updated_at = NOW()
       RETURNING *`,
      [
        id,
        data.tenantId,
        data.entityId,
        data.originalFilename,
        data.mimeType,
        data.sizeBytes,
        data.contentHash,
        data.objectKey,
        data.isPublic ?? false,
        data.status || 'PENDING',
      ]
    );
    const r = res.rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      entityId: r.entity_id,
      originalFilename: r.original_filename,
      mimeType: r.mime_type,
      sizeBytes: Number(r.size_bytes),
      contentHash: r.content_hash,
      objectKey: r.object_key,
      isPublic: r.is_public,
      status: r.status,
      errorMessage: r.error_message,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async updateDocumentStatus(tenantId: string, documentId: string, status: Document['status'], errorMessage?: string): Promise<void> {
    await this.pool.query(
      'UPDATE documents SET status = $1, error_message = $2, updated_at = NOW() WHERE tenant_id = $3 AND id = $4',
      [status, errorMessage || null, tenantId, documentId]
    );
  }

  async deleteDocument(tenantId: string, entityId: string, documentId: string): Promise<boolean> {
    const res = await this.pool.query(
      'DELETE FROM documents WHERE tenant_id = $1 AND entity_id = $2 AND id = $3 RETURNING id',
      [tenantId, entityId, documentId]
    );
    return (res.rowCount ?? 0) > 0;
  }

  // Document Versions
  async createDocumentVersion(data: {
    tenantId: string;
    entityId: string;
    documentId: string;
    versionNumber: number;
    contentHash: string;
    objectKey: string;
    sizeBytes: number;
    processingVersion?: string;
  }): Promise<DocumentVersion> {
    const id = generateUuid();
    const res = await this.pool.query(
      `INSERT INTO document_versions (id, tenant_id, entity_id, document_id, version_number, content_hash, object_key, size_bytes, processing_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        id,
        data.tenantId,
        data.entityId,
        data.documentId,
        data.versionNumber,
        data.contentHash,
        data.objectKey,
        data.sizeBytes,
        data.processingVersion || 'v1',
      ]
    );
    const r = res.rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      entityId: r.entity_id,
      documentId: r.document_id,
      versionNumber: r.version_number,
      contentHash: r.content_hash,
      objectKey: r.object_key,
      sizeBytes: Number(r.size_bytes),
      processingVersion: r.processing_version,
      createdAt: r.created_at,
    };
  }

  // Ingestion Jobs
  async getJobById(tenantId: string, entityId: string, jobId: string): Promise<IngestionJob | null> {
    if (!isValidUuid(tenantId) || !isValidUuid(entityId) || !isValidUuid(jobId)) return null;
    const res = await this.pool.query(
      'SELECT * FROM ingestion_jobs WHERE tenant_id = $1 AND entity_id = $2 AND id = $3',
      [tenantId, entityId, jobId]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      entityId: r.entity_id,
      status: r.status,
      totalDocuments: r.total_documents,
      processedDocuments: r.processed_documents,
      failedDocuments: r.failed_documents,
      retryCount: r.retry_count,
      errorSummary: r.error_summary,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async createIngestionJob(data: { id?: string; tenantId: string; entityId: string; totalDocuments: number }): Promise<IngestionJob> {
    const id = data.id || generateUuid();
    const res = await this.pool.query(
      `INSERT INTO ingestion_jobs (id, tenant_id, entity_id, status, total_documents)
       VALUES ($1, $2, $3, 'PENDING', $4)
       RETURNING *`,
      [id, data.tenantId, data.entityId, data.totalDocuments]
    );
    const r = res.rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      entityId: r.entity_id,
      status: r.status,
      totalDocuments: r.total_documents,
      processedDocuments: r.processed_documents,
      failedDocuments: r.failed_documents,
      retryCount: r.retry_count,
      errorSummary: r.error_summary,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async updateJobStatus(tenantId: string, jobId: string, status: IngestionJob['status'], details?: { processed?: number; failed?: number; errorSummary?: string }): Promise<void> {
    if (!isValidUuid(tenantId) || !isValidUuid(jobId)) return;
    const updates = ['status = $1', 'updated_at = NOW()'];
    const params: any[] = [status];
    let idx = 2;

    if (details?.processed !== undefined) {
      updates.push(`processed_documents = $${idx++}`);
      params.push(details.processed);
    }
    if (details?.failed !== undefined) {
      updates.push(`failed_documents = $${idx++}`);
      params.push(details.failed);
    }
    if (details?.errorSummary !== undefined) {
      updates.push(`error_summary = $${idx++}`);
      params.push(details.errorSummary);
    }

    params.push(tenantId, jobId);
    await this.pool.query(
      `UPDATE ingestion_jobs SET ${updates.join(', ')} WHERE tenant_id = $${idx++} AND id = $${idx}`,
      params
    );
  }

  async createJobDocument(tenantId: string, jobId: string, documentId: string): Promise<IngestionJobDocument> {
    const id = generateUuid();
    const res = await this.pool.query(
      `INSERT INTO ingestion_job_documents (id, tenant_id, job_id, document_id, status)
       VALUES ($1, $2, $3, $4, 'PENDING')
       RETURNING *`,
      [id, tenantId, jobId, documentId]
    );
    const r = res.rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      jobId: r.job_id,
      documentId: r.document_id,
      status: r.status,
      errorMessage: r.error_message,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async updateJobDocumentStatus(tenantId: string, jobId: string, documentId: string, status: Document['status'], errorMessage?: string): Promise<void> {
    if (!isValidUuid(tenantId) || !isValidUuid(jobId) || !isValidUuid(documentId)) return;
    await this.pool.query(
      'UPDATE ingestion_job_documents SET status = $1, error_message = $2, updated_at = NOW() WHERE tenant_id = $3 AND job_id = $4 AND document_id = $5',
      [status, errorMessage || null, tenantId, jobId, documentId]
    );
  }

  async getJobDocuments(tenantId: string, jobId: string): Promise<(IngestionJobDocument & { document?: Document })[]> {
    if (!isValidUuid(tenantId) || !isValidUuid(jobId)) return [];
    const res = await this.pool.query(
      `SELECT jd.*, d.original_filename, d.mime_type, d.size_bytes, d.is_public
       FROM ingestion_job_documents jd
       LEFT JOIN documents d ON jd.document_id = d.id AND jd.tenant_id = d.tenant_id
       WHERE jd.tenant_id = $1 AND jd.job_id = $2`,
      [tenantId, jobId]
    );
    return res.rows.map(r => ({
      id: r.id,
      tenantId: r.tenant_id,
      jobId: r.job_id,
      documentId: r.document_id,
      status: r.status,
      errorMessage: r.error_message,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      document: r.original_filename
        ? {
            id: r.document_id,
            tenantId: r.tenant_id,
            entityId: '',
            originalFilename: r.original_filename,
            mimeType: r.mime_type,
            sizeBytes: Number(r.size_bytes),
            contentHash: '',
            objectKey: '',
            isPublic: r.is_public,
            status: r.status,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
          }
        : undefined,
    }));
  }

  // Chunks & Hybrid Search
  async insertChunks(chunks: Array<Omit<DocumentChunk, 'id' | 'createdAt'>>): Promise<DocumentChunk[]> {
    const inserted: DocumentChunk[] = [];
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const castExpr = this.hasVector ? '$11::vector' : '$11::real[]';

      for (const item of chunks) {
        const id = generateUuid();
        const embeddingVal = item.embedding
          ? (this.hasVector ? `[${item.embedding.join(',')}]` : item.embedding)
          : null;

        const res = await client.query(
          `INSERT INTO document_chunks (
            id, tenant_id, entity_id, document_id, version_id, chunk_index,
            chunk_text, page_number, start_offset, end_offset, embedding, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, ${castExpr}, $12)
          RETURNING id, created_at`,
          [
            id,
            item.tenantId,
            item.entityId,
            item.documentId,
            item.versionId || null,
            item.chunkIndex,
            item.chunkText,
            item.pageNumber || null,
            item.startOffset || null,
            item.endOffset || null,
            embeddingVal,
            JSON.stringify(item.metadata || {}),
          ]
        );

        inserted.push({
          ...item,
          id: res.rows[0].id,
          createdAt: res.rows[0].created_at,
        });
      }
      await client.query('COMMIT');
      return inserted;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async deleteChunksByDocument(tenantId: string, documentId: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM document_chunks WHERE tenant_id = $1 AND document_id = $2',
      [tenantId, documentId]
    );
  }

  async hasPlaceholderChunks(tenantId: string, documentId: string): Promise<boolean> {
    const res = await this.pool.query(
      `SELECT id FROM document_chunks 
       WHERE tenant_id = $1 AND document_id = $2 
         AND (chunk_text LIKE '%[Image document OCR text extracted%' OR chunk_text LIKE '%[Scanned Image Document:%') 
       LIMIT 1`,
      [tenantId, documentId]
    );
    return res.rows.length > 0;
  }

  async getChunksByIds(tenantId: string, chunkIds: string[]): Promise<DocumentChunk[]> {
    if (chunkIds.length === 0) return [];
    const res = await this.pool.query(
      `SELECT * FROM document_chunks WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, chunkIds]
    );
    return res.rows.map(r => ({
      id: r.id,
      tenantId: r.tenant_id,
      entityId: r.entity_id,
      documentId: r.document_id,
      versionId: r.version_id,
      chunkIndex: r.chunk_index,
      chunkText: r.chunk_text,
      pageNumber: r.page_number,
      startOffset: r.start_offset,
      endOffset: r.end_offset,
      metadata: r.metadata,
      createdAt: r.created_at,
    }));
  }

  async searchChunks(params: {
    tenantId: string;
    entityId: string;
    query: string;
    queryEmbedding?: number[];
    topK?: number;
    minScore?: number;
    rrfK?: number;
    isPublicOnly?: boolean;
  }): Promise<ScoredChunk[]> {
    const { tenantId, entityId, query, queryEmbedding, topK = 10, rrfK = 60, isPublicOnly = false } = params;
    const embeddingParam = this.hasVector
      ? (queryEmbedding ? `[${queryEmbedding.join(',')}]` : null)
      : (queryEmbedding || null);
    const denseOrder = this.hasVector
      ? 'c.embedding <=> $4::vector'
      : 'cosine_similarity(c.embedding, $4::real[]) DESC';

    // Hybrid search using PostgreSQL Full-Text Search (tsvector) and vector similarity
    const sql = `
      WITH dense_candidates AS (
        SELECT 
          c.id,
          ROW_NUMBER() OVER (ORDER BY ${denseOrder}) as dense_rank
        FROM document_chunks c
        JOIN documents d ON c.document_id = d.id AND c.tenant_id = d.tenant_id
        WHERE c.tenant_id = $1 AND c.entity_id = $2
          AND ($5::boolean = FALSE OR d.is_public = TRUE)
          AND c.embedding IS NOT NULL
        LIMIT 50
      ),
      sparse_candidates AS (
        SELECT 
          c.id,
          ROW_NUMBER() OVER (ORDER BY ts_rank_cd(c.tsv_content, plainto_tsquery('english', $3)) DESC) as sparse_rank
        FROM document_chunks c
        JOIN documents d ON c.document_id = d.id AND c.tenant_id = d.tenant_id
        WHERE c.tenant_id = $1 AND c.entity_id = $2
          AND ($5::boolean = FALSE OR d.is_public = TRUE)
          AND c.tsv_content @@ plainto_tsquery('english', $3)
        LIMIT 50
      ),
      fused AS (
        SELECT 
          COALESCE(d.id, s.id) as id,
          COALESCE(1.0 / ($6 + d.dense_rank), 0.0) + COALESCE(1.0 / ($6 + s.sparse_rank), 0.0) as rrf_score,
          d.dense_rank,
          s.sparse_rank
        FROM dense_candidates d
        FULL OUTER JOIN sparse_candidates s ON d.id = s.id
      )
      SELECT 
        c.*,
        f.rrf_score,
        f.dense_rank,
        f.sparse_rank,
        d.original_filename,
        d.mime_type,
        d.size_bytes,
        d.is_public as doc_is_public,
        d.status as doc_status
      FROM fused f
      JOIN document_chunks c ON f.id = c.id
      JOIN documents d ON c.document_id = d.id AND c.tenant_id = d.tenant_id
      ORDER BY f.rrf_score DESC
      LIMIT $7;
    `;

    try {
      const res = await this.pool.query(sql, [
        tenantId,
        entityId,
        query,
        embeddingParam,
        isPublicOnly,
        rrfK,
        topK,
      ]);

      return res.rows.map(r => ({
        chunk: {
          id: r.id,
          tenantId: r.tenant_id,
          entityId: r.entity_id,
          documentId: r.document_id,
          versionId: r.version_id,
          chunkIndex: r.chunk_index,
          chunkText: r.chunk_text,
          pageNumber: r.page_number,
          startOffset: r.start_offset,
          endOffset: r.end_offset,
          metadata: r.metadata,
          createdAt: r.created_at,
        },
        document: {
          id: r.document_id,
          tenantId: r.tenant_id,
          entityId: r.entity_id,
          originalFilename: r.original_filename,
          mimeType: r.mime_type,
          sizeBytes: Number(r.size_bytes),
          contentHash: '',
          objectKey: '',
          isPublic: r.doc_is_public,
          status: r.doc_status,
          createdAt: r.created_at,
          updatedAt: r.created_at,
        },
        score: parseFloat(r.rrf_score),
        denseRank: r.dense_rank ? parseInt(r.dense_rank, 10) : undefined,
        sparseRank: r.sparse_rank ? parseInt(r.sparse_rank, 10) : undefined,
      }));
    } catch (err) {
      logger.error('PostgreSQL hybrid search error:', err);
      return [];
    }
  }

  // Conversations & Messages
  async getConversationById(tenantId: string, entityId: string, conversationId: string): Promise<Conversation | null> {
    const res = await this.pool.query(
      'SELECT * FROM conversations WHERE tenant_id = $1 AND entity_id = $2 AND id = $3',
      [tenantId, entityId, conversationId]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      entityId: r.entity_id,
      userId: r.user_id,
      sessionToken: r.session_token,
      title: r.title,
      isPublic: r.is_public,
      contextSummary: r.context_summary,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async getConversationsByEntity(tenantId: string, entityId: string): Promise<Conversation[]> {
    const res = await this.pool.query(
      'SELECT * FROM conversations WHERE tenant_id = $1 AND entity_id = $2 ORDER BY updated_at DESC',
      [tenantId, entityId]
    );
    return res.rows.map(r => ({
      id: r.id,
      tenantId: r.tenant_id,
      entityId: r.entity_id,
      userId: r.user_id,
      sessionToken: r.session_token,
      title: r.title,
      isPublic: r.is_public,
      contextSummary: r.context_summary,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async createConversation(data: {
    id?: string;
    tenantId: string;
    entityId: string;
    userId?: string;
    sessionToken?: string;
    title?: string;
    isPublic?: boolean;
  }): Promise<Conversation> {
    const id = data.id || generateUuid();
    const res = await this.pool.query(
      `INSERT INTO conversations (id, tenant_id, entity_id, user_id, session_token, title, is_public)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [id, data.tenantId, data.entityId, data.userId || null, data.sessionToken || null, data.title || 'New Conversation', data.isPublic ?? false]
    );
    const r = res.rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      entityId: r.entity_id,
      userId: r.user_id,
      sessionToken: r.session_token,
      title: r.title,
      isPublic: r.is_public,
      contextSummary: r.context_summary,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async getRecentMessages(tenantId: string, conversationId: string, limit = 10): Promise<Message[]> {
    const res = await this.pool.query(
      `SELECT * FROM messages
       WHERE tenant_id = $1 AND conversation_id = $2
       ORDER BY created_at ASC
       LIMIT $3`,
      [tenantId, conversationId, limit]
    );
    return res.rows.map(r => ({
      id: r.id,
      tenantId: r.tenant_id,
      entityId: r.entity_id,
      conversationId: r.conversation_id,
      senderRole: r.sender_role,
      content: r.content,
      rewrittenQuery: r.rewritten_query,
      insufficientEvidence: r.insufficient_evidence,
      confidenceScore: r.confidence_score ? parseFloat(r.confidence_score) : undefined,
      metadata: r.metadata,
      createdAt: r.created_at,
    }));
  }

  async createMessage(data: {
    id?: string;
    tenantId: string;
    entityId: string;
    conversationId: string;
    senderRole: 'user' | 'assistant' | 'system';
    content: string;
    rewrittenQuery?: string;
    insufficientEvidence?: boolean;
    confidenceScore?: number;
    metadata?: Record<string, any>;
  }): Promise<Message> {
    const id = data.id || generateUuid();
    const res = await this.pool.query(
      `INSERT INTO messages (
        id, tenant_id, entity_id, conversation_id, sender_role, content,
        rewritten_query, insufficient_evidence, confidence_score, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        id,
        data.tenantId,
        data.entityId,
        data.conversationId,
        data.senderRole,
        data.content,
        data.rewrittenQuery || null,
        data.insufficientEvidence ?? false,
        data.confidenceScore || null,
        JSON.stringify(data.metadata || {}),
      ]
    );
    const r = res.rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      entityId: r.entity_id,
      conversationId: r.conversation_id,
      senderRole: r.sender_role,
      content: r.content,
      rewrittenQuery: r.rewritten_query,
      insufficientEvidence: r.insufficient_evidence,
      confidenceScore: r.confidence_score ? parseFloat(r.confidence_score) : undefined,
      metadata: r.metadata,
      createdAt: r.created_at,
    };
  }

  // Citations
  async createCitations(citations: Array<Omit<AnswerCitation, 'id' | 'createdAt'>>): Promise<AnswerCitation[]> {
    if (citations.length === 0) return [];
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted: AnswerCitation[] = [];
      for (const c of citations) {
        const id = generateUuid();
        const res = await client.query(
          `INSERT INTO answer_citations (id, tenant_id, entity_id, message_id, chunk_id, document_id, snippet, page_number, score)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [id, c.tenantId, c.entityId, c.messageId, c.chunkId, c.documentId, c.snippet, c.pageNumber || null, c.score || null]
        );
        const r = res.rows[0];
        inserted.push({
          id: r.id,
          tenantId: r.tenant_id,
          entityId: r.entity_id,
          messageId: r.message_id,
          chunkId: r.chunk_id,
          documentId: r.document_id,
          snippet: r.snippet,
          pageNumber: r.page_number,
          score: r.score ? parseFloat(r.score) : undefined,
          createdAt: r.created_at,
        });
      }
      await client.query('COMMIT');
      return inserted;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async getCitationsByMessage(messageId: string): Promise<AnswerCitation[]> {
    const res = await this.pool.query(
      `SELECT c.*, d.original_filename as document_title
       FROM answer_citations c
       LEFT JOIN documents d ON c.document_id = d.id AND c.tenant_id = d.tenant_id
       WHERE c.message_id = $1`,
      [messageId]
    );
    return res.rows.map(r => ({
      id: r.id,
      tenantId: r.tenant_id,
      entityId: r.entity_id,
      messageId: r.message_id,
      chunkId: r.chunk_id,
      documentId: r.document_id,
      snippet: r.snippet,
      pageNumber: r.page_number,
      score: r.score ? parseFloat(r.score) : undefined,
      documentTitle: r.document_title,
      createdAt: r.created_at,
    }));
  }
}

