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
  CrawlJob,
  CrawlPage,
  CrawlConfig,
  AnalyticsEvent,
  AITokenLog,
  AnalyticsFilterParams,
  PortalAnalyticsOverview,
  SourceAnalyticsData,
  ProcessingPerformanceData,
  AITokenConsumptionData,
  ChatUsageData,
  SourceActivityData,
  FailureAnalyticsData,
  FailureCategory,
  SourceCategory,
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

  async getPublicEntityByReference(reference: string): Promise<Entity | null> {
    const res = await this.pool.query(
      `SELECT * FROM entities 
       WHERE (id::text = $1 OR LOWER(slug) = LOWER($1) OR LOWER(portfolio_url) = LOWER($1) OR LOWER(portal_url) = LOWER($1))
         AND is_public = true
       LIMIT 1`,
      [reference]
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
    const res = await this.pool.query('SELECT * FROM entities WHERE tenant_id = $1 ORDER BY created_at DESC', [tenantId]);
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

  async getDocumentByObjectKey(objectKey: string): Promise<Document | null> {
    const res = await this.pool.query(
      'SELECT * FROM documents WHERE object_key = $1 LIMIT 1',
      [objectKey]
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
      `SELECT d.*, jd.source_url, jd.stage,
              COALESCE(d.source_type, j.source_type, CASE WHEN jd.source_url IS NOT NULL THEN 'URL_IMPORT' ELSE 'DIRECT_UPLOAD' END) AS effective_source_type
       FROM documents d
       LEFT JOIN LATERAL (
         SELECT source_url, stage, job_id
         FROM ingestion_job_documents
         WHERE document_id = d.id AND tenant_id = d.tenant_id
         ORDER BY created_at DESC LIMIT 1
       ) jd ON TRUE
       LEFT JOIN ingestion_jobs j ON j.id = jd.job_id
       WHERE d.tenant_id = $1 AND d.entity_id = $2
       ORDER BY d.created_at DESC`,
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
      sourceUrl: r.source_url || undefined,
      stage: r.stage || undefined,
      sourceType: r.effective_source_type || r.source_type || 'DIRECT_UPLOAD',
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async getDocumentCountByEntity(tenantId: string, entityId: string): Promise<number> {
    if (!isValidUuid(tenantId) || !isValidUuid(entityId)) return 0;
    // Count user inputs only: directly uploaded files/links + distinct website crawls (excluding child/extended routes)
    const res = await this.pool.query(
      `SELECT 
         (SELECT COUNT(*)::int FROM documents WHERE tenant_id = $1 AND entity_id = $2 AND (source_type IS NULL OR source_type != 'WEBSITE_CRAWL'))
         +
         GREATEST(
           (SELECT COUNT(*)::int FROM crawl_jobs WHERE tenant_id = $1 AND entity_id = $2),
           CASE WHEN EXISTS(SELECT 1 FROM documents WHERE tenant_id = $1 AND entity_id = $2 AND source_type = 'WEBSITE_CRAWL') THEN 1 ELSE 0 END
         )
       AS count`,
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
    sourceType?: string;
  }): Promise<Document> {
    const id = data.id && isValidUuid(data.id) ? data.id : generateUuid();
    const sourceType = data.sourceType || 'DIRECT_UPLOAD';
    const res = await this.pool.query(
      `INSERT INTO documents (id, tenant_id, entity_id, original_filename, mime_type, size_bytes, content_hash, object_key, is_public, status, source_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (entity_id, content_hash) DO UPDATE SET
         original_filename = EXCLUDED.original_filename,
         source_type = COALESCE(EXCLUDED.source_type, documents.source_type),
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
        sourceType,
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
      sourceType: r.source_type || sourceType,
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

  async updateDocumentMetadata(
    tenantId: string,
    documentId: string,
    data: {
      originalFilename?: string;
      mimeType?: string;
      sizeBytes?: number;
      contentHash?: string;
      objectKey?: string;
      status?: Document['status'];
      errorMessage?: string;
    }
  ): Promise<void> {
    const sizeParam = data.sizeBytes !== undefined && data.sizeBytes > 0 ? data.sizeBytes : null;
    try {
      await this.pool.query(
        `UPDATE documents SET
           original_filename = COALESCE($1, original_filename),
           mime_type = COALESCE($2, mime_type),
           size_bytes = COALESCE($3, size_bytes),
           content_hash = COALESCE($4, content_hash),
           object_key = COALESCE($5, object_key),
           status = COALESCE($6, status),
           error_message = COALESCE($7, error_message),
           updated_at = NOW()
         WHERE tenant_id = $8 AND id = $9`,
        [
          data.originalFilename || null,
          data.mimeType || null,
          sizeParam,
          data.contentHash || null,
          data.objectKey || null,
          data.status || null,
          data.errorMessage || null,
          tenantId,
          documentId,
        ]
      );
    } catch (err: any) {
      // If updating content_hash encounters a unique constraint violation (code 23505),
      // update all metadata EXCEPT content_hash so size_bytes and filename are not lost
      if (err.code === '23505') {
        await this.pool.query(
          `UPDATE documents SET
             original_filename = COALESCE($1, original_filename),
             mime_type = COALESCE($2, mime_type),
             size_bytes = COALESCE($3, size_bytes),
             object_key = COALESCE($4, object_key),
             status = COALESCE($5, status),
             error_message = COALESCE($6, error_message),
             updated_at = NOW()
           WHERE tenant_id = $7 AND id = $8`,
          [
            data.originalFilename || null,
            data.mimeType || null,
            sizeParam,
            data.objectKey || null,
            data.status || null,
            data.errorMessage || null,
            tenantId,
            documentId,
          ]
        );
      } else {
        throw err;
      }
    }
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

  async getDocumentVersions(tenantId: string, documentId: string): Promise<DocumentVersion[]> {
    if (!isValidUuid(tenantId) || !isValidUuid(documentId)) return [];
    const res = await this.pool.query(
      `SELECT * FROM document_versions WHERE tenant_id = $1 AND document_id = $2 ORDER BY version_number DESC`,
      [tenantId, documentId]
    );
    return res.rows.map(r => ({
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
    }));
  }

  async getLatestDocumentVersion(tenantId: string, documentId: string): Promise<DocumentVersion | null> {
    const versions = await this.getDocumentVersions(tenantId, documentId);
    return versions[0] || null;
  }

  async activateDocumentVersion(
    tenantId: string,
    documentId: string,
    versionId: string,
    updates?: { contentHash?: string; objectKey?: string; sizeBytes?: number }
  ): Promise<void> {
    if (!isValidUuid(tenantId) || !isValidUuid(documentId) || !isValidUuid(versionId)) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const setClauses = ['active_version_id = $3', "status = 'READY'", 'updated_at = NOW()'];
      const values: any[] = [tenantId, documentId, versionId];

      if (updates?.contentHash) {
        values.push(updates.contentHash);
        setClauses.push(`content_hash = $${values.length}`);
      }
      if (updates?.objectKey) {
        values.push(updates.objectKey);
        setClauses.push(`object_key = $${values.length}`);
      }
      if (updates?.sizeBytes !== undefined) {
        values.push(updates.sizeBytes);
        setClauses.push(`size_bytes = $${values.length}`);
      }

      await client.query(
        `UPDATE documents SET ${setClauses.join(', ')} WHERE tenant_id = $1 AND id = $2`,
        values
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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

  async createIngestionJob(data: { id?: string; tenantId: string; entityId: string; totalDocuments: number; sourceType?: string; metadata?: Record<string, any> }): Promise<IngestionJob> {
    const id = data.id || generateUuid();
    const sourceType = data.sourceType || 'DIRECT_UPLOAD';
    const metadata = JSON.stringify(data.metadata || {});
    const res = await this.pool.query(
      `INSERT INTO ingestion_jobs (id, tenant_id, entity_id, status, total_documents, source_type, metadata)
       VALUES ($1, $2, $3, 'PENDING', $4, $5, $6::jsonb)
       RETURNING *`,
      [id, data.tenantId, data.entityId, data.totalDocuments, sourceType, metadata]
    );
    const r = res.rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      entityId: r.entity_id,
      status: r.status,
      sourceType: r.source_type,
      totalDocuments: r.total_documents,
      processedDocuments: r.processed_documents,
      failedDocuments: r.failed_documents,
      retryCount: r.retry_count,
      errorSummary: r.error_summary,
      metadata: r.metadata,
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

  async createJobDocument(tenantId: string, jobId: string, documentId: string, extra?: { sourceUrl?: string; stage?: string; downloadMetadata?: Record<string, any> }): Promise<IngestionJobDocument> {
    const id = generateUuid();
    const sourceUrl = extra?.sourceUrl || null;
    const stage = extra?.stage || 'PENDING';
    const downloadMetadata = JSON.stringify(extra?.downloadMetadata || {});
    const res = await this.pool.query(
      `INSERT INTO ingestion_job_documents (id, tenant_id, job_id, document_id, status, source_url, stage, download_metadata)
       VALUES ($1, $2, $3, $4, 'PENDING', $5, $6, $7::jsonb)
       RETURNING *`,
      [id, tenantId, jobId, documentId, sourceUrl, stage, downloadMetadata]
    );
    const r = res.rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      jobId: r.job_id,
      documentId: r.document_id,
      status: r.status,
      sourceUrl: r.source_url,
      stage: r.stage,
      errorMessage: r.error_message,
      downloadMetadata: r.download_metadata,
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

  async updateJobDocumentStage(tenantId: string, jobId: string, documentId: string, stage: string, errorMessage?: string, downloadMetadata?: Record<string, any>): Promise<void> {
    if (!isValidUuid(tenantId) || !isValidUuid(jobId) || !isValidUuid(documentId)) return;
    if (downloadMetadata) {
      await this.pool.query(
        'UPDATE ingestion_job_documents SET stage = $1, error_message = $2, download_metadata = COALESCE(download_metadata, \'{}\'::jsonb) || $3::jsonb, updated_at = NOW() WHERE tenant_id = $4 AND job_id = $5 AND document_id = $6',
        [stage, errorMessage || null, JSON.stringify(downloadMetadata), tenantId, jobId, documentId]
      );
    } else {
      await this.pool.query(
        'UPDATE ingestion_job_documents SET stage = $1, error_message = $2, updated_at = NOW() WHERE tenant_id = $3 AND job_id = $4 AND document_id = $5',
        [stage, errorMessage || null, tenantId, jobId, documentId]
      );
    }
  }

  async getJobDocumentByDocumentId(documentId: string): Promise<IngestionJobDocument | null> {
    if (!isValidUuid(documentId)) return null;
    const res = await this.pool.query(
      'SELECT * FROM ingestion_job_documents WHERE document_id = $1 ORDER BY created_at DESC LIMIT 1',
      [documentId]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      jobId: r.job_id,
      documentId: r.document_id,
      status: r.status,
      sourceUrl: r.source_url,
      stage: r.stage,
      errorMessage: r.error_message,
      downloadMetadata: r.download_metadata,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }


  // Crawl Jobs & Pages
  async createCrawlJob(data: {
    id?: string;
    tenantId: string;
    entityId: string;
    rootUrl: string;
    config?: CrawlConfig;
  }): Promise<CrawlJob> {
    const id = data.id && isValidUuid(data.id) ? data.id : generateUuid();
    const config = data.config || {};
    const res = await this.pool.query(
      `INSERT INTO crawl_jobs (id, tenant_id, entity_id, root_url, config, status)
       VALUES ($1, $2, $3, $4, $5, 'queued')
       RETURNING *`,
      [id, data.tenantId, data.entityId, data.rootUrl, JSON.stringify(config)]
    );
    return this.mapCrawlJobRow(res.rows[0]);
  }

  async getCrawlJob(tenantId: string, entityId: string, crawlJobId: string): Promise<CrawlJob | null> {
    if (!isValidUuid(tenantId) || !isValidUuid(entityId) || !isValidUuid(crawlJobId)) return null;
    await this.syncCrawlJobAggregates(tenantId, crawlJobId);
    const res = await this.pool.query(
      `SELECT * FROM crawl_jobs WHERE tenant_id = $1 AND entity_id = $2 AND id = $3`,
      [tenantId, entityId, crawlJobId]
    );
    if (res.rows.length === 0) return null;
    return this.mapCrawlJobRow(res.rows[0]);
  }

  async listCrawlJobs(tenantId: string, entityId: string): Promise<CrawlJob[]> {
    if (!isValidUuid(tenantId) || !isValidUuid(entityId)) return [];
    const res = await this.pool.query(
      `SELECT * FROM crawl_jobs WHERE tenant_id = $1 AND entity_id = $2 ORDER BY created_at DESC`,
      [tenantId, entityId]
    );
    const jobs = res.rows.map(r => this.mapCrawlJobRow(r));
    for (let i = 0; i < jobs.length; i++) {
      if (jobs[i].status === 'discovering' || jobs[i].status === 'processing_pages' || jobs[i].status === 'queued') {
        const synced = await this.syncCrawlJobAggregates(tenantId, jobs[i].id);
        if (synced) {
          jobs[i] = synced;
        }
      }
    }
    return jobs;
  }

  async updateCrawlJob(tenantId: string, crawlJobId: string, updates: Partial<CrawlJob>): Promise<void> {
    if (!isValidUuid(tenantId) || !isValidUuid(crawlJobId)) return;
    const setClauses: string[] = ['updated_at = NOW()'];
    const values: any[] = [tenantId, crawlJobId];

    if (updates.status !== undefined) {
      values.push(updates.status);
      setClauses.push(`status = $${values.length}`);
    }
    if (updates.discoveredCount !== undefined) {
      values.push(updates.discoveredCount);
      setClauses.push(`discovered_count = $${values.length}`);
    }
    if (updates.queuedCount !== undefined) {
      values.push(updates.queuedCount);
      setClauses.push(`queued_count = $${values.length}`);
    }
    if (updates.processingCount !== undefined) {
      values.push(updates.processingCount);
      setClauses.push(`processing_count = $${values.length}`);
    }
    if (updates.completedCount !== undefined) {
      values.push(updates.completedCount);
      setClauses.push(`completed_count = $${values.length}`);
    }
    if (updates.failedCount !== undefined) {
      values.push(updates.failedCount);
      setClauses.push(`failed_count = $${values.length}`);
    }
    if (updates.skippedCount !== undefined) {
      values.push(updates.skippedCount);
      setClauses.push(`skipped_count = $${values.length}`);
    }
    if (updates.errorSummary !== undefined) {
      values.push(updates.errorSummary);
      setClauses.push(`error_summary = $${values.length}`);
    }
    if (updates.completedAt !== undefined) {
      values.push(updates.completedAt);
      setClauses.push(`completed_at = $${values.length}`);
    } else if (updates.status === 'completed' || updates.status === 'completed_with_errors' || updates.status === 'failed') {
      setClauses.push(`completed_at = NOW()`);
    }

    await this.pool.query(
      `UPDATE crawl_jobs SET ${setClauses.join(', ')} WHERE tenant_id = $1 AND id = $2`,
      values
    );
  }

  async createCrawlPages(pages: Array<{
    tenantId: string;
    entityId: string;
    crawlJobId: string;
    documentId?: string;
    originalUrl: string;
    normalizedUrl: string;
    depth?: number;
  }>): Promise<CrawlPage[]> {
    const results: CrawlPage[] = [];
    for (const p of pages) {
      if (!isValidUuid(p.tenantId) || !isValidUuid(p.crawlJobId)) continue;
      const id = generateUuid();
      const res = await this.pool.query(
        `INSERT INTO crawl_pages (id, tenant_id, entity_id, crawl_job_id, document_id, original_url, normalized_url, depth, status, stage)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'discovered', 'DISCOVERED')
         ON CONFLICT (crawl_job_id, normalized_url) DO UPDATE SET
           document_id = COALESCE(EXCLUDED.document_id, crawl_pages.document_id),
           updated_at = NOW()
         RETURNING *`,
        [id, p.tenantId, p.entityId, p.crawlJobId, p.documentId || null, p.originalUrl, p.normalizedUrl, p.depth || 0]
      );
      results.push(this.mapCrawlPageRow(res.rows[0]));
    }
    return results;
  }

  async getCrawlPages(tenantId: string, crawlJobId: string): Promise<CrawlPage[]> {
    if (!isValidUuid(tenantId) || !isValidUuid(crawlJobId)) return [];
    await this.syncCrawlJobAggregates(tenantId, crawlJobId);
    const res = await this.pool.query(
      `SELECT * FROM crawl_pages WHERE tenant_id = $1 AND crawl_job_id = $2 ORDER BY depth ASC, created_at ASC`,
      [tenantId, crawlJobId]
    );
    return res.rows.map(r => this.mapCrawlPageRow(r));
  }

  async getCrawlPageByUrl(tenantId: string, crawlJobId: string, normalizedUrl: string): Promise<CrawlPage | null> {
    if (!isValidUuid(tenantId) || !isValidUuid(crawlJobId)) return null;
    const res = await this.pool.query(
      `SELECT * FROM crawl_pages WHERE tenant_id = $1 AND crawl_job_id = $2 AND normalized_url = $3 LIMIT 1`,
      [tenantId, crawlJobId, normalizedUrl]
    );
    if (res.rows.length === 0) return null;
    return this.mapCrawlPageRow(res.rows[0]);
  }

  async updateCrawlPage(tenantId: string, crawlJobId: string, pageIdOrUrl: string, updates: Partial<CrawlPage>): Promise<void> {
    if (!isValidUuid(tenantId) || !isValidUuid(crawlJobId)) return;
    const isUuid = isValidUuid(pageIdOrUrl);
    const cleanUrl = typeof pageIdOrUrl === 'string' ? pageIdOrUrl.replace(/\/+$/, '') : pageIdOrUrl;
    const setClauses: string[] = ['updated_at = NOW()'];
    const values: any[] = [tenantId, crawlJobId, isUuid ? pageIdOrUrl : cleanUrl];

    if (updates.status !== undefined) {
      values.push(updates.status);
      setClauses.push(`status = $${values.length}`);
    }
    if (updates.stage !== undefined) {
      values.push(updates.stage);
      setClauses.push(`stage = $${values.length}`);
    }
    if (updates.documentId !== undefined) {
      values.push(updates.documentId);
      setClauses.push(`document_id = $${values.length}`);
    }
    if (updates.title !== undefined) {
      values.push(updates.title);
      setClauses.push(`title = $${values.length}`);
    }
    if (updates.canonicalUrl !== undefined) {
      values.push(updates.canonicalUrl);
      setClauses.push(`canonical_url = $${values.length}`);
    }
    if (updates.contentHash !== undefined) {
      values.push(updates.contentHash);
      setClauses.push(`content_hash = $${values.length}`);
    }
    if (updates.objectKey !== undefined) {
      values.push(updates.objectKey);
      setClauses.push(`object_key = $${values.length}`);
    }
    if (updates.sizeBytes !== undefined) {
      values.push(updates.sizeBytes);
      setClauses.push(`size_bytes = $${values.length}`);
    }
    if (updates.errorMessage !== undefined) {
      values.push(updates.errorMessage);
      setClauses.push(`error_message = $${values.length}`);
    }
    if (updates.retryCount !== undefined) {
      values.push(updates.retryCount);
      setClauses.push(`retry_count = $${values.length}`);
    }
    if (updates.status === 'completed' || updates.status === 'skipped' || updates.status === 'failed') {
      setClauses.push(`completed_at = NOW()`);
    }

    const idClause = isUuid ? 'id = $3' : 'normalized_url = $3';

    await this.pool.query(
      `UPDATE crawl_pages SET ${setClauses.join(', ')} WHERE tenant_id = $1 AND crawl_job_id = $2 AND ${idClause}`,
      values
    );
  }

  async getCrawlPageByDocumentId(tenantId: string, documentId: string): Promise<CrawlPage | null> {
    if (!isValidUuid(tenantId) || !isValidUuid(documentId)) return null;
    const res = await this.pool.query(
      `SELECT * FROM crawl_pages WHERE tenant_id = $1 AND document_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [tenantId, documentId]
    );
    if (res.rows.length === 0) return null;
    return this.mapCrawlPageRow(res.rows[0]);
  }

  async syncCrawlJobAggregates(tenantId: string, crawlJobId: string): Promise<CrawlJob | null> {
    if (!isValidUuid(tenantId) || !isValidUuid(crawlJobId)) return null;

    // 1. Authoritative status reconciliation: Sync crawl_pages with downstream document statuses
    await this.pool.query(
      `UPDATE crawl_pages cp
       SET status = 'completed', stage = 'READY', completed_at = COALESCE(cp.completed_at, NOW()), updated_at = NOW()
       FROM documents d
       WHERE cp.tenant_id = $1 AND cp.crawl_job_id = $2
         AND cp.document_id = d.id
         AND d.status = 'READY'
         AND cp.status != 'completed'`,
      [tenantId, crawlJobId]
    );

    await this.pool.query(
      `UPDATE crawl_pages cp
       SET status = 'failed', stage = 'FAILED', error_message = COALESCE(cp.error_message, d.error_message, 'Document ingestion failed'), completed_at = COALESCE(cp.completed_at, NOW()), updated_at = NOW()
       FROM documents d
       WHERE cp.tenant_id = $1 AND cp.crawl_job_id = $2
         AND cp.document_id = d.id
         AND d.status = 'FAILED'
         AND cp.status != 'failed' AND cp.status != 'skipped'`,
      [tenantId, crawlJobId]
    );

    // Auto-heal stale pages: If a page has been stuck in fetching/extracting for > 5 minutes, mark failed so crawl is never trapped
    await this.pool.query(
      `UPDATE crawl_pages
       SET status = 'failed', stage = 'FAILED', error_message = 'Page processing timed out (worker terminated unexpectedly)', completed_at = NOW(), updated_at = NOW()
       WHERE tenant_id = $1 AND crawl_job_id = $2
         AND status IN ('fetching', 'extracting')
         AND updated_at < NOW() - INTERVAL '5 minutes'`,
      [tenantId, crawlJobId]
    );

    // Auto-heal stale uploaded pages: If markdown was uploaded to storage > 5 mins ago, reconcile to completed
    await this.pool.query(
      `UPDATE crawl_pages cp
       SET status = 'completed', stage = 'READY', completed_at = COALESCE(cp.completed_at, NOW()), updated_at = NOW()
       WHERE cp.tenant_id = $1 AND cp.crawl_job_id = $2
         AND cp.status = 'uploaded'
         AND cp.object_key IS NOT NULL
         AND cp.updated_at < NOW() - INTERVAL '5 minutes'`,
      [tenantId, crawlJobId]
    );

    const countRes = await this.pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'queued' OR status = 'discovered')::int AS queued,
         COUNT(*) FILTER (WHERE status IN ('fetching', 'extracting', 'uploaded', 'ingesting'))::int AS processing,
         COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
         COUNT(*) FILTER (WHERE status = 'skipped')::int AS skipped,
         COUNT(*) FILTER (WHERE is_unchanged = TRUE)::int AS unchanged,
         COUNT(*) FILTER (WHERE status = 'completed' AND is_unchanged = FALSE)::int AS changed
       FROM crawl_pages
       WHERE tenant_id = $1 AND crawl_job_id = $2`,
      [tenantId, crawlJobId]
    );

    const counts = countRes.rows[0] || {};
    const total = Number(counts.total) || 0;
    const queued = Number(counts.queued) || 0;
    const processing = Number(counts.processing) || 0;
    const completed = Number(counts.completed) || 0;
    const failed = Number(counts.failed) || 0;
    const skipped = Number(counts.skipped) || 0;
    const unchanged = Number(counts.unchanged) || 0;
    const changed = Number(counts.changed) || 0;

    const jobRes = await this.pool.query(
      `SELECT * FROM crawl_jobs WHERE tenant_id = $1 AND id = $2`,
      [tenantId, crawlJobId]
    );
    if (jobRes.rows.length === 0) return null;
    const currentJob = this.mapCrawlJobRow(jobRes.rows[0]);

    let newStatus = currentJob.status;
    const isTerminal =
      currentJob.status === 'completed' ||
      currentJob.status === 'completed_with_errors' ||
      currentJob.status === 'failed' ||
      currentJob.status === 'cancelled';

    if (!isTerminal && currentJob.status !== 'discovering') {
      if (queued > 0 || processing > 0) {
        newStatus = 'processing_pages';
      } else if (total > 0 && queued === 0 && processing === 0) {
        if (failed === total) {
          newStatus = 'failed';
        } else {
          newStatus = 'completed';
        }
      }
    }

    const completedAtClause =
      newStatus === 'completed' || newStatus === 'completed_with_errors' || newStatus === 'failed'
        ? `, completed_at = COALESCE(completed_at, NOW())`
        : '';

    const updateRes = await this.pool.query(
      `UPDATE crawl_jobs
       SET
         discovered_count = $1,
         queued_count = $2,
         processing_count = $3,
         completed_count = $4,
         failed_count = $5,
         skipped_count = $6,
         unchanged_count = $7,
         changed_count = $8,
         status = $9,
         refetch_status = CASE WHEN refetch_status = 'refetching' AND $2 = 0 AND $3 = 0 AND $1 > 0 THEN (CASE WHEN $5 = $1 THEN 'failed' ELSE 'completed' END) ELSE refetch_status END,
         updated_at = NOW()
         ${completedAtClause}
       WHERE tenant_id = $10 AND id = $11
       RETURNING *`,
      [total, queued, processing, completed, failed, skipped, unchanged, changed, newStatus, tenantId, crawlJobId]
    );

    // 2. Synchronize the paired ingestion_jobs record so Ingestion Job Status tracks crawl lifecycle
    let ingestionJobStatus: string = 'PROCESSING';
    if (newStatus === 'completed') {
      ingestionJobStatus = 'READY';
    } else if (newStatus === 'failed') {
      ingestionJobStatus = 'FAILED';
    } else if (newStatus === 'discovering' || newStatus === 'processing_pages') {
      ingestionJobStatus = 'PROCESSING';
    }

    await this.pool.query(
      `UPDATE ingestion_jobs
       SET
         total_documents = GREATEST(total_documents, $1),
         processed_documents = $2,
         failed_documents = $3,
         status = $4,
         updated_at = NOW()
       WHERE tenant_id = $5 AND id = $6`,
      [total, completed, failed, ingestionJobStatus, tenantId, crawlJobId]
    );

    // 3. Synchronize the root job document so Document Ingestion Breakdown does not prematurely show READY
    if (newStatus !== 'completed' && newStatus !== 'failed') {
      await this.pool.query(
        `UPDATE ingestion_job_documents
         SET status = 'PROCESSING',
             stage = CASE WHEN $1 = 'discovering' THEN 'FETCHING_PAGE' ELSE 'PROCESSING' END,
             updated_at = NOW()
         WHERE tenant_id = $2 AND job_id = $3
           AND (download_metadata->>'depth' = '0' OR download_metadata->>'source' = 'root')`,
        [newStatus, tenantId, crawlJobId]
      );
    } else if (newStatus === 'completed') {
      await this.pool.query(
        `UPDATE ingestion_job_documents
         SET status = 'READY', stage = 'READY', updated_at = NOW()
         WHERE tenant_id = $1 AND job_id = $2
           AND (download_metadata->>'depth' = '0' OR download_metadata->>'source' = 'root')`,
        [tenantId, crawlJobId]
      );
    } else if (newStatus === 'failed') {
      await this.pool.query(
        `UPDATE ingestion_job_documents
         SET status = 'FAILED', stage = 'FAILED', updated_at = NOW()
         WHERE tenant_id = $1 AND job_id = $2
           AND (download_metadata->>'depth' = '0' OR download_metadata->>'source' = 'root')`,
        [tenantId, crawlJobId]
      );
    }

    return updateRes.rows[0] ? this.mapCrawlJobRow(updateRes.rows[0]) : null;
  }

  async incrementCrawlCounters(tenantId: string, crawlJobId: string, increments: {
    discovered?: number;
    queued?: number;
    processing?: number;
    completed?: number;
    failed?: number;
    skipped?: number;
  }): Promise<void> {
    if (!isValidUuid(tenantId) || !isValidUuid(crawlJobId)) return;
    await this.pool.query(
      `UPDATE crawl_jobs SET
         discovered_count = discovered_count + $1,
         queued_count = queued_count + $2,
         processing_count = processing_count + $3,
         completed_count = completed_count + $4,
         failed_count = failed_count + $5,
         skipped_count = skipped_count + $6,
         updated_at = NOW()
       WHERE tenant_id = $7 AND id = $8`,
      [
        increments.discovered || 0,
        increments.queued || 0,
        increments.processing || 0,
        increments.completed || 0,
        increments.failed || 0,
        increments.skipped || 0,
        tenantId,
        crawlJobId,
      ]
    );
  }

  private mapCrawlJobRow(r: any): CrawlJob {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      entityId: r.entity_id,
      rootUrl: r.root_url,
      status: r.status,
      config: typeof r.config === 'string' ? JSON.parse(r.config) : r.config || {},
      discoveredCount: Number(r.discovered_count || 0),
      queuedCount: Number(r.queued_count || 0),
      processingCount: Number(r.processing_count || 0),
      completedCount: Number(r.completed_count || 0),
      failedCount: Number(r.failed_count || 0),
      skippedCount: Number(r.skipped_count || 0),
      errorSummary: r.error_summary || undefined,
      lastRefetchedAt: r.last_refetched_at || undefined,
      refetchStatus: r.refetch_status || 'idle',
      unchangedCount: Number(r.unchanged_count || 0),
      changedCount: Number(r.changed_count || 0),
      newlyDiscoveredCount: Number(r.newly_discovered_count || 0),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      completedAt: r.completed_at || undefined,
    };
  }

  private mapCrawlPageRow(r: any): CrawlPage {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      entityId: r.entity_id,
      crawlJobId: r.crawl_job_id,
      documentId: r.document_id || undefined,
      originalUrl: r.original_url,
      normalizedUrl: r.normalized_url,
      canonicalUrl: r.canonical_url || undefined,
      title: r.title || undefined,
      contentHash: r.content_hash || undefined,
      objectKey: r.object_key || undefined,
      status: r.status,
      stage: r.stage || undefined,
      depth: Number(r.depth || 0),
      retryCount: Number(r.retry_count || 0),
      sizeBytes: r.size_bytes ? Number(r.size_bytes) : undefined,
      errorMessage: r.error_message || undefined,
      isUnchanged: Boolean(r.is_unchanged),
      versionId: r.version_id || undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      completedAt: r.completed_at || undefined,
    };
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
      sourceUrl: r.source_url,
      stage: r.stage,
      downloadMetadata: r.download_metadata,
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
          AND (d.active_version_id IS NULL OR c.version_id IS NULL OR c.version_id = d.active_version_id)
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
          AND (d.active_version_id IS NULL OR c.version_id IS NULL OR c.version_id = d.active_version_id)
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

  // -------------------------------------------------------------
  // Analytics & AI Attribution Database Implementation
  // -------------------------------------------------------------

  private parseDateFilter(params: AnalyticsFilterParams): { startDate: Date; endDate: Date; periodLabel: string } {
    const now = new Date();
    let startDate: Date;
    let endDate = new Date(now);
    let periodLabel = params.period || '30d';

    if (params.startDate) {
      startDate = new Date(params.startDate);
      if (params.endDate) {
        endDate = new Date(params.endDate);
        if (params.endDate.length <= 10) {
          endDate.setHours(23, 59, 59, 999);
        }
      }
      periodLabel = params.period || 'custom';
    } else if (params.period === 'today') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      periodLabel = 'today';
    } else if (params.period === '7d') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      periodLabel = '7d';
    } else if (params.period === '90d') {
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      periodLabel = '90d';
    } else {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      periodLabel = '30d';
    }

    return { startDate, endDate, periodLabel };
  }

  async recordAnalyticsEvent(data: Omit<AnalyticsEvent, 'id' | 'createdAt'>): Promise<AnalyticsEvent> {
    const id = generateUuid();
    const res = await this.pool.query(
      `INSERT INTO analytics_events (
        id, tenant_id, entity_id, event_type, request_origin,
        source_id, document_id, document_version_id, ingestion_job_id,
        crawl_job_id, conversation_id, session_id, request_id,
        status, duration_ms, source_category, file_type, stage,
        failure_category, metadata, created_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12, $13,
        $14, $15, $16, $17, $18,
        $19, $20, NOW()
      ) RETURNING *`,
      [
        id,
        data.tenantId,
        data.entityId,
        data.eventType,
        data.requestOrigin || 'PORTAL_UI',
        data.sourceId || null,
        data.documentId || null,
        data.documentVersionId || null,
        data.ingestionJobId || null,
        data.crawlJobId || null,
        data.conversationId || null,
        data.sessionId || null,
        data.requestId || null,
        data.status || 'SUCCESS',
        data.durationMs || null,
        data.sourceCategory || null,
        data.fileType || null,
        data.stage || null,
        data.failureCategory || null,
        JSON.stringify(data.metadata || {}),
      ]
    );

    const r = res.rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      entityId: r.entity_id,
      eventType: r.event_type,
      requestOrigin: r.request_origin,
      sourceId: r.source_id,
      documentId: r.document_id,
      documentVersionId: r.document_version_id,
      ingestionJobId: r.ingestion_job_id,
      crawlJobId: r.crawl_job_id,
      conversationId: r.conversation_id,
      sessionId: r.session_id,
      requestId: r.request_id,
      status: r.status,
      durationMs: r.duration_ms,
      sourceCategory: r.source_category,
      fileType: r.file_type,
      stage: r.stage,
      failureCategory: r.failure_category,
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata || {},
      createdAt: r.created_at,
    };
  }

  async recordAITokenLog(data: Omit<AITokenLog, 'id' | 'createdAt'>): Promise<AITokenLog> {
    const id = generateUuid();
    const res = await this.pool.query(
      `INSERT INTO ai_token_logs (
        id, tenant_id, entity_id, request_origin, operation_type,
        provider, model_name, input_tokens, output_tokens, total_tokens,
        is_estimated, conversation_id, session_id, request_id,
        duration_ms, status, metadata, created_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16, $17, NOW()
      ) RETURNING *`,
      [
        id,
        data.tenantId,
        data.entityId,
        data.requestOrigin || 'PORTAL_UI',
        data.operationType,
        data.provider,
        data.modelName,
        data.inputTokens || 0,
        data.outputTokens || 0,
        data.totalTokens || 0,
        Boolean(data.isEstimated),
        data.conversationId || null,
        data.sessionId || null,
        data.requestId || null,
        data.durationMs || 0,
        data.status || 'SUCCESS',
        JSON.stringify(data.metadata || {}),
      ]
    );

    const r = res.rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      entityId: r.entity_id,
      requestOrigin: r.request_origin,
      operationType: r.operation_type,
      provider: r.provider,
      modelName: r.model_name,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      totalTokens: r.total_tokens,
      isEstimated: r.is_estimated,
      conversationId: r.conversation_id,
      sessionId: r.session_id,
      requestId: r.request_id,
      durationMs: r.duration_ms,
      status: r.status,
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata || {},
      createdAt: r.created_at,
    };
  }

  async getAnalyticsOverview(
    tenantId: string,
    entityId: string,
    params: AnalyticsFilterParams
  ): Promise<PortalAnalyticsOverview> {
    const { startDate, endDate, periodLabel } = this.parseDateFilter(params);

    // 1. Direct files/links breakdown for this portal (excluding internal website crawl child routes)
    const docRes = await this.pool.query(
      `SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status = 'READY')::int as successful,
        COUNT(*) FILTER (WHERE status = 'FAILED')::int as failed,
        COUNT(*) FILTER (WHERE status IN ('PROCESSING', 'PENDING'))::int as processing
       FROM documents
       WHERE tenant_id = $1 AND entity_id = $2
         AND (source_type IS NULL OR source_type != 'WEBSITE_CRAWL')
         AND created_at >= $3 AND created_at <= $4`,
      [tenantId, entityId, startDate, endDate]
    );
    const dRow = docRes.rows[0] || { total: 0, successful: 0, failed: 0, processing: 0 };
    const directTotal = Number(dRow.total || 0);
    const directSuccessful = Number(dRow.successful || 0);
    const directFailed = Number(dRow.failed || 0);
    const directProcessing = Number(dRow.processing || 0);

    // 2. Parent website crawl jobs breakdown (excluding cancelled crawls)
    const crawlRes = await this.pool.query(
      `SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status IN ('completed', 'completed_with_errors'))::int as successful,
        COUNT(*) FILTER (WHERE status = 'failed')::int as failed,
        COUNT(*) FILTER (WHERE status IN ('queued', 'discovering', 'processing_pages'))::int as processing
       FROM crawl_jobs
       WHERE tenant_id = $1 AND entity_id = $2
         AND status != 'cancelled'
         AND created_at >= $3 AND created_at <= $4`,
      [tenantId, entityId, startDate, endDate]
    );
    const cRow = crawlRes.rows[0] || { total: 0, successful: 0, failed: 0, processing: 0 };
    let crawlTotal = Number(cRow.total || 0);
    let crawlSuccessful = Number(cRow.successful || 0);
    let crawlFailed = Number(cRow.failed || 0);
    let crawlProcessing = Number(cRow.processing || 0);

    // Fallback if crawl_jobs table has no records but crawl documents exist in period
    if (crawlTotal === 0) {
      const fallbackCheck = await this.pool.query(
        `SELECT COUNT(*)::int as count FROM documents WHERE tenant_id = $1 AND entity_id = $2 AND source_type = 'WEBSITE_CRAWL' AND created_at >= $3 AND created_at <= $4`,
        [tenantId, entityId, startDate, endDate]
      );
      if (Number(fallbackCheck.rows[0]?.count || 0) > 0) {
        crawlTotal = 1;
        crawlSuccessful = 1;
      }
    }

    const total = directTotal + crawlTotal;
    const successful = directSuccessful + crawlSuccessful;
    const failed = directFailed + crawlFailed;
    const processing = directProcessing + crawlProcessing;
    const successRate = total > 0 ? Math.round((successful / total) * 100) : 100;

    // 3. Average processing duration across unique top-level sources (direct documents and parent website crawls)
    let avgDuration = 0;
    const allDurationsRes = await this.pool.query(
      `SELECT
        GREATEST(800, ROUND(EXTRACT(EPOCH FROM (updated_at - created_at)) * 1000))::int as duration_ms
       FROM documents
       WHERE tenant_id = $1 AND entity_id = $2
         AND status = 'READY'
         AND (source_type IS NULL OR source_type != 'WEBSITE_CRAWL')
         AND created_at >= $3 AND created_at <= $4
       UNION ALL
       SELECT
        GREATEST(800, ROUND(EXTRACT(EPOCH FROM (COALESCE(completed_at, updated_at) - created_at)) * 1000))::int as duration_ms
       FROM crawl_jobs
       WHERE tenant_id = $1 AND entity_id = $2
         AND status IN ('completed', 'completed_with_errors')
         AND created_at >= $3 AND created_at <= $4`,
      [tenantId, entityId, startDate, endDate]
    );

    if (allDurationsRes.rows.length > 0) {
      const durs = allDurationsRes.rows.map((r: any) => Number(r.duration_ms));
      avgDuration = Math.round(durs.reduce((a: number, b: number) => a + b, 0) / durs.length);
    } else {
      const durRes = await this.pool.query(
        `SELECT AVG(duration_ms)::int as avg_duration
         FROM analytics_events
         WHERE tenant_id = $1 AND entity_id = $2
           AND event_type = 'INGESTION_COMPLETION'
           AND duration_ms IS NOT NULL
           AND created_at >= $3 AND created_at <= $4`,
        [tenantId, entityId, startDate, endDate]
      );
      avgDuration = Number(durRes.rows[0]?.avg_duration || 0);
    }

    // 4. Chat questions
    const chatRes = await this.pool.query(
      `SELECT COUNT(*)::int as question_count
       FROM analytics_events
       WHERE tenant_id = $1 AND entity_id = $2
         AND event_type = 'CHAT_REQUEST_RECEIVED'
         AND created_at >= $3 AND created_at <= $4`,
      [tenantId, entityId, startDate, endDate]
    );
    const chatQuestions = Number(chatRes.rows[0]?.question_count || 0);

    // 5. Token totals
    const tokenRes = await this.pool.query(
      `SELECT
        COALESCE(SUM(total_tokens), 0)::bigint as total_tokens,
        COALESCE(SUM(total_tokens) FILTER (WHERE request_origin = 'PORTAL_UI'), 0)::bigint as portal_ui_tokens,
        COALESCE(SUM(total_tokens) FILTER (WHERE request_origin = 'EXTERNAL_INTEGRATION'), 0)::bigint as external_tokens,
        COALESCE(SUM(total_tokens) FILTER (WHERE operation_type = 'EMBEDDING'), 0)::bigint as embedding_tokens,
        COUNT(*) FILTER (WHERE operation_type = 'EMBEDDING')::int as embedding_requests
       FROM ai_token_logs
       WHERE tenant_id = $1 AND entity_id = $2
         AND created_at >= $3 AND created_at <= $4`,
      [tenantId, entityId, startDate, endDate]
    );
    const tRow = tokenRes.rows[0] || {
      total_tokens: 0,
      portal_ui_tokens: 0,
      external_tokens: 0,
      embedding_tokens: 0,
      embedding_requests: 0,
    };
    let ovTotalTokens = Number(tRow.total_tokens || 0);
    let ovPortalUiTokens = Number(tRow.portal_ui_tokens || 0);
    const ovExternalTokens = Number(tRow.external_tokens || 0);
    const ovEmbeddingTokens = Number(tRow.embedding_tokens || 0);
    const ovEmbeddingRequests = Number(tRow.embedding_requests || 0);

    const ovChunkTokensRes = await this.pool.query(
      `SELECT
         COUNT(DISTINCT d.id)::int as doc_count,
         ROUND(COALESCE(SUM(LENGTH(c.chunk_text) / 4), 0))::bigint as est_tokens
       FROM document_chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE d.tenant_id = $1 AND d.entity_id = $2
         AND d.status = 'READY'
         AND d.created_at >= $3 AND d.created_at <= $4`,
      [tenantId, entityId, startDate, endDate]
    );
    const ovEstTokens = Number(ovChunkTokensRes.rows[0]?.est_tokens || 0);
    const ovReadyDocs = Number(ovChunkTokensRes.rows[0]?.doc_count || 0);
    if (
      ovEstTokens > 0 &&
      (ovEmbeddingTokens === 0 || (ovReadyDocs > ovEmbeddingRequests && ovEstTokens > ovEmbeddingTokens))
    ) {
      const deltaTokens = ovEmbeddingTokens === 0 ? ovEstTokens : (ovEstTokens - ovEmbeddingTokens);
      ovTotalTokens += deltaTokens;
      ovPortalUiTokens += deltaTokens;
    }

    return {
      totalSources: total,
      successfulSources: successful,
      failedSources: failed,
      processingSources: processing,
      successRatePercentage: successRate,
      averageProcessingTimeMs: avgDuration,
      totalChatQuestions: chatQuestions,
      totalTokensConsumed: ovTotalTokens,
      externalIntegrationTokens: ovExternalTokens,
      portalUiTokens: ovPortalUiTokens,
      period: periodLabel,
      timezone: 'UTC',
    };
  }

  async getSourceAnalytics(
    tenantId: string,
    entityId: string,
    params: AnalyticsFilterParams
  ): Promise<SourceAnalyticsData> {
    const { startDate, endDate } = this.parseDateFilter(params);

    // 1. Direct sources breakdown (Files & Links & Single-Page Website Imports, excluding multi-page crawl child routes)
    const docRes = await this.pool.query(
      `SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status = 'READY')::int as successful,
        COUNT(*) FILTER (WHERE status = 'FAILED')::int as failed,
        COUNT(*) FILTER (WHERE status IN ('PROCESSING', 'PENDING'))::int as processing,
        COUNT(*) FILTER (WHERE source_type = 'URL_IMPORT')::int as links,
        COUNT(*) FILTER (WHERE source_type = 'WEBSITE_IMPORT')::int as single_page_websites,
        COUNT(*) FILTER (WHERE source_type NOT IN ('WEBSITE_IMPORT', 'WEBSITE_CRAWL', 'URL_IMPORT'))::int as files
       FROM documents
       WHERE tenant_id = $1 AND entity_id = $2
         AND (source_type IS NULL OR source_type != 'WEBSITE_CRAWL')
         AND created_at >= $3 AND created_at <= $4`,
      [tenantId, entityId, startDate, endDate]
    );
    const d = docRes.rows[0] || {};
    const directTotal = Number(d.total || 0);
    const directSuccessful = Number(d.successful || 0);
    const directFailed = Number(d.failed || 0);
    const directProcessing = Number(d.processing || 0);
    const links = Number(d.links || 0);
    const singlePageWebsites = Number(d.single_page_websites || 0);
    const files = Number(d.files || 0);

    // 2. Parent website crawl jobs breakdown
    const crawlRes = await this.pool.query(
      `SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status IN ('completed', 'completed_with_errors'))::int as successful,
        COUNT(*) FILTER (WHERE status = 'failed')::int as failed,
        COUNT(*) FILTER (WHERE status IN ('queued', 'discovering', 'processing_pages'))::int as processing
       FROM crawl_jobs
       WHERE tenant_id = $1 AND entity_id = $2
         AND status != 'cancelled'
         AND created_at >= $3 AND created_at <= $4`,
      [tenantId, entityId, startDate, endDate]
    );
    const cj = crawlRes.rows[0] || {};
    let crawlTotal = Number(cj.total || 0);
    let crawlSuccessful = Number(cj.successful || 0);
    let crawlFailed = Number(cj.failed || 0);
    let crawlProcessing = Number(cj.processing || 0);

    // Fallback if crawl_jobs table has no records but crawl documents exist
    if (crawlTotal === 0) {
      const fallbackCheck = await this.pool.query(
        `SELECT COUNT(*)::int as count FROM documents WHERE tenant_id = $1 AND entity_id = $2 AND source_type = 'WEBSITE_CRAWL' AND created_at >= $3 AND created_at <= $4`,
        [tenantId, entityId, startDate, endDate]
      );
      if (Number(fallbackCheck.rows[0]?.count || 0) > 0) {
        crawlTotal = 1;
        crawlSuccessful = 1;
      }
    }

    const websites = singlePageWebsites + crawlTotal;
    const total = files + links + websites;
    const successful = directSuccessful + crawlSuccessful;
    const failed = directFailed + crawlFailed;
    const processing = directProcessing + crawlProcessing;

    // Events breakdown
    const evRes = await this.pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE event_type = 'SOURCE_SUBMISSION')::int as submissions,
        COUNT(*) FILTER (WHERE event_type = 'DUPLICATE_DETECTION')::int as duplicates,
        COUNT(*) FILTER (WHERE event_type = 'CONFIRMED_REPLACEMENT')::int as replacements,
        COUNT(*) FILTER (WHERE event_type = 'WEBSITE_REFETCH')::int as refetches,
        COUNT(*) FILTER (WHERE event_type = 'UNCHANGED_WEBSITE_REFETCH')::int as unchanged_refetches,
        COUNT(*) FILTER (WHERE event_type = 'SOURCE_DELETION')::int as deletions
       FROM analytics_events
       WHERE tenant_id = $1 AND entity_id = $2
         AND created_at >= $3 AND created_at <= $4`,
      [tenantId, entityId, startDate, endDate]
    );
    const ev = evRes.rows[0] || {};
    const submissions = Number(ev.submissions || total);
    const duplicates = Number(ev.duplicates || 0);
    const replacements = Number(ev.replacements || 0);
    const refetches = Number(ev.refetches || 0);
    const unchangedRefetches = Number(ev.unchanged_refetches || 0);
    const deletions = Number(ev.deletions || 0);

    // Crawl pages (discovered routes in the period)
    const crawlPagesRes = await this.pool.query(
      `SELECT
        COUNT(*)::int as total_pages,
        COUNT(*) FILTER (WHERE is_unchanged = false)::int as changed_pages
       FROM crawl_pages
       WHERE tenant_id = $1 AND entity_id = $2
         AND created_at >= $3 AND created_at <= $4`,
      [tenantId, entityId, startDate, endDate]
    );
    const cp = crawlPagesRes.rows[0] || {};
    let discoveredRoutes = Number(cp.total_pages || 0);
    if (discoveredRoutes === 0) {
      const crawlDocsRes = await this.pool.query(
        `SELECT COUNT(*)::int as count FROM documents WHERE tenant_id = $1 AND entity_id = $2 AND source_type = 'WEBSITE_CRAWL' AND created_at >= $3 AND created_at <= $4`,
        [tenantId, entityId, startDate, endDate]
      );
      discoveredRoutes = Number(crawlDocsRes.rows[0]?.count || 0);
    }
    const changedWebsitePages = Number(cp.changed_pages || 0);

    // File type distribution (only for direct files & links, excluding internal crawl child routes)
    const ftRes = await this.pool.query(
      `SELECT
        CASE
          WHEN mime_type ILIKE '%pdf%' THEN 'pdf'
          WHEN mime_type ILIKE '%word%' OR mime_type ILIKE '%docx%' THEN 'docx'
          WHEN mime_type ILIKE '%doc%' THEN 'doc'
          WHEN mime_type ILIKE '%plain%' THEN 'txt'
          WHEN mime_type ILIKE '%markdown%' THEN 'markdown'
          WHEN mime_type ILIKE '%png%' THEN 'png'
          WHEN mime_type ILIKE '%jpeg%' OR mime_type ILIKE '%jpg%' THEN 'jpeg'
          WHEN mime_type ILIKE '%webp%' THEN 'webp'
          ELSE 'other'
        END as file_type,
        COUNT(*)::int as count
       FROM documents
       WHERE tenant_id = $1 AND entity_id = $2
         AND (source_type IS NULL OR source_type != 'WEBSITE_CRAWL')
         AND created_at >= $3 AND created_at <= $4
       GROUP BY file_type
       ORDER BY count DESC`,
      [tenantId, entityId, startDate, endDate]
    );
    const fileTypeDistribution = ftRes.rows.map((r: any) => ({
      fileType: r.file_type,
      count: Number(r.count),
      percentage: files + links > 0 ? Math.round((Number(r.count) / (files + links)) * 100) : 0,
    }));

    // Volume over time (daily buckets for parent sources only)
    const volRes = await this.pool.query(
      `SELECT
        TO_CHAR(d.day, 'YYYY-MM-DD') as date,
        COALESCE(COUNT(DISTINCT doc.id) FILTER (WHERE doc.source_type NOT IN ('WEBSITE_IMPORT', 'WEBSITE_CRAWL', 'URL_IMPORT')), 0)::int as files,
        COALESCE(COUNT(DISTINCT doc.id) FILTER (WHERE doc.source_type = 'URL_IMPORT'), 0)::int as links,
        (
          COALESCE(COUNT(DISTINCT doc.id) FILTER (WHERE doc.source_type = 'WEBSITE_IMPORT'), 0) +
          COALESCE(COUNT(DISTINCT cj.id), 0)
        )::int as websites,
        (
          COALESCE(COUNT(DISTINCT doc.id) FILTER (WHERE doc.source_type IS NULL OR doc.source_type != 'WEBSITE_CRAWL'), 0) +
          COALESCE(COUNT(DISTINCT cj.id), 0)
        )::int as total
       FROM generate_series($3::date, $4::date, '1 day'::interval) d(day)
       LEFT JOIN documents doc ON doc.tenant_id = $1 AND doc.entity_id = $2 AND doc.created_at::date = d.day::date AND (doc.source_type IS NULL OR doc.source_type != 'WEBSITE_CRAWL') AND doc.created_at >= $3 AND doc.created_at <= $4
       LEFT JOIN crawl_jobs cj ON cj.tenant_id = $1 AND cj.entity_id = $2 AND cj.created_at::date = d.day::date AND cj.status != 'cancelled' AND cj.created_at >= $3 AND cj.created_at <= $4
       GROUP BY d.day
       ORDER BY d.day ASC`,
      [tenantId, entityId, startDate, endDate]
    );

    const totalOps = successful + failed + processing;

    return {
      uniqueSources: total,
      totalSubmissions: submissions + duplicates,
      newUploads: submissions,
      successfulUploads: successful,
      failedUploads: failed,
      sourcesCurrentlyProcessing: processing,
      confirmedReuploads: replacements,
      duplicateAttempts: duplicates,
      existingReplacements: replacements,
      updatedSourceVersions: replacements + (refetches - unchangedRefetches),
      websiteRefetches: refetches,
      unchangedWebsiteRefetches: unchangedRefetches,
      changedWebsitePages,
      discoveredRoutes,
      removedRoutes: 0,
      deletedSources: deletions,
      ingestionOutcomes: {
        successful,
        failed,
        processing,
        pending: 0,
        totalOperations: totalOps > 0 ? totalOps : total,
      },
      categoryDistribution: {
        files,
        links,
        websites,
        total,
      },
      fileTypeDistribution,
      volumeOverTime: volRes.rows.map((r: any) => ({
        date: r.date,
        files: Number(r.files),
        links: Number(r.links),
        websites: Number(r.websites),
        total: Number(r.total),
      })),
    };
  }

  async getProcessingPerformance(
    tenantId: string,
    entityId: string,
    params: AnalyticsFilterParams
  ): Promise<ProcessingPerformanceData> {
    const { startDate, endDate } = this.parseDateFilter(params);

    // 1. Direct documents (files and file links, excluding child website crawl routes)
    const directDocsRes = await this.pool.query(
      `SELECT
        GREATEST(800, ROUND(EXTRACT(EPOCH FROM (updated_at - created_at)) * 1000))::int as duration_ms,
        CASE
          WHEN mime_type ILIKE '%pdf%' THEN 'pdf'
          WHEN mime_type ILIKE '%word%' OR mime_type ILIKE '%docx%' THEN 'docx'
          WHEN mime_type ILIKE '%doc%' THEN 'doc'
          WHEN mime_type ILIKE '%plain%' THEN 'txt'
          WHEN mime_type ILIKE '%markdown%' THEN 'markdown'
          WHEN mime_type ILIKE '%png%' THEN 'png'
          WHEN mime_type ILIKE '%jpeg%' OR mime_type ILIKE '%jpg%' THEN 'jpeg'
          WHEN mime_type ILIKE '%webp%' THEN 'webp'
          ELSE 'other'
        END as file_type,
        CASE
          WHEN source_type = 'URL_IMPORT' THEN 'LINK'
          ELSE 'FILE'
        END as source_category
       FROM documents
       WHERE tenant_id = $1 AND entity_id = $2
         AND status = 'READY'
         AND (source_type IS NULL OR source_type != 'WEBSITE_CRAWL')
         AND created_at >= $3 AND created_at <= $4
       ORDER BY duration_ms ASC`,
      [tenantId, entityId, startDate, endDate]
    );

    // 2. Parent website crawl extractions (each crawl job is 1 website source with N discovered/processed routes)
    const crawlRes = await this.pool.query(
      `SELECT
        id,
        status,
        COALESCE(discovered_count, 1)::int as discovered_count,
        COALESCE(completed_count, discovered_count, 1)::int as completed_count,
        GREATEST(800, ROUND(EXTRACT(EPOCH FROM (COALESCE(completed_at, updated_at) - created_at)) * 1000))::int as duration_ms
       FROM crawl_jobs
       WHERE tenant_id = $1 AND entity_id = $2
         AND status IN ('completed', 'completed_with_errors')
         AND created_at >= $3 AND created_at <= $4
       ORDER BY duration_ms ASC`,
      [tenantId, entityId, startDate, endDate]
    );

    let crawlList = crawlRes.rows.map((r: any) => ({
      id: r.id,
      completedCount: Number(r.completed_count || r.discovered_count || 1),
      durationMs: Number(r.duration_ms),
    }));

    // Fallback if crawl_jobs table has no records but child crawl documents exist in period
    if (crawlList.length === 0) {
      const crawlFallbackRes = await this.pool.query(
        `SELECT
          COUNT(*)::int as child_count,
          GREATEST(800, ROUND(EXTRACT(EPOCH FROM (MAX(updated_at) - MIN(created_at))) * 1000))::int as duration_ms
         FROM documents
         WHERE tenant_id = $1 AND entity_id = $2
           AND status = 'READY'
           AND source_type = 'WEBSITE_CRAWL'
           AND created_at >= $3 AND created_at <= $4`,
        [tenantId, entityId, startDate, endDate]
      );
      const childCount = Number(crawlFallbackRes.rows[0]?.child_count || 0);
      if (childCount > 0) {
        crawlList = [{
          id: 'crawl-fallback',
          completedCount: childCount,
          durationMs: Number(crawlFallbackRes.rows[0]?.duration_ms || 1000),
        }];
      }
    }

    const filesDurations = directDocsRes.rows.filter((r: any) => r.source_category === 'FILE').map((r: any) => Number(r.duration_ms));
    const linksDurations = directDocsRes.rows.filter((r: any) => r.source_category === 'LINK').map((r: any) => Number(r.duration_ms));
    const crawlDurations = crawlList.map((c) => c.durationMs);
    const totalCrawlRoutes = crawlList.reduce((acc, c) => acc + c.completedCount, 0);
    const websiteProcessedCount = crawlDurations.length;

    const allDurations = [...filesDurations, ...linksDurations, ...crawlDurations].sort((a, b) => a - b);
    const totalSourcesProcessed = filesDurations.length + linksDurations.length + websiteProcessedCount;

    // Optional fallback if no direct documents or crawls found but analytics_events has ingestion completions
    if (allDurations.length === 0) {
      const eventDurRes = await this.pool.query(
        `SELECT duration_ms FROM analytics_events
         WHERE tenant_id = $1 AND entity_id = $2
           AND event_type = 'INGESTION_COMPLETION'
           AND duration_ms IS NOT NULL
           AND created_at >= $3 AND created_at <= $4
         ORDER BY duration_ms ASC`,
        [tenantId, entityId, startDate, endDate]
      );
      for (const r of eventDurRes.rows) {
        allDurations.push(Number(r.duration_ms));
      }
    }

    const median = (arr: number[]) => {
      if (arr.length === 0) return 0;
      const mid = Math.floor(arr.length / 2);
      return arr.length % 2 !== 0 ? arr[mid] : Math.round((arr[mid - 1] + arr[mid]) / 2);
    };

    const avgOf = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
    const avg = avgOf(allDurations);
    const fastest = allDurations.length > 0 ? allDurations[0] : 0;
    const slowest = allDurations.length > 0 ? allDurations[allDurations.length - 1] : 0;

    // Performance by file type (direct files plus website source)
    const fileTypeMap = new Map<string, number[]>();
    for (const r of directDocsRes.rows) {
      const ft = r.file_type || 'pdf';
      if (!fileTypeMap.has(ft)) fileTypeMap.set(ft, []);
      fileTypeMap.get(ft)!.push(Number(r.duration_ms));
    }

    const byFileType: ProcessingPerformanceData['byFileType'] = [];
    for (const [ft, times] of fileTypeMap.entries()) {
      const sorted = [...times].sort((a, b) => a - b);
      byFileType.push({
        fileType: ft,
        processedCount: times.length,
        avgDurationMs: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
        medianDurationMs: median(sorted),
        successRate: 100,
        failureCount: 0,
      });
    }

    if (websiteProcessedCount > 0) {
      byFileType.push({
        fileType: 'website',
        processedCount: websiteProcessedCount,
        avgDurationMs: avgOf(crawlDurations),
        medianDurationMs: median(crawlDurations),
        successRate: 100,
        failureCount: 0,
      });
    }

    byFileType.sort((a, b) => b.processedCount - a.processedCount);

    return {
      overall: {
        avgProcessingTimeMs: avg,
        medianProcessingTimeMs: median(allDurations),
        fastestProcessingTimeMs: fastest,
        slowestProcessingTimeMs: slowest,
        sourcesProcessed: totalSourcesProcessed > 0 ? totalSourcesProcessed : allDurations.length,
      },
      byCategory: {
        files: {
          avgProcessingTimeMs: avgOf(filesDurations),
          medianProcessingTimeMs: median(filesDurations),
          processedCount: filesDurations.length,
          successRate: 100,
          failureCount: 0,
        },
        links: {
          totalProcessed: linksDurations.length,
          successful: linksDurations.length,
          failed: 0,
          avgDownloadTimeMs: Math.round(avgOf(linksDurations) * 0.3),
          avgExtractionTimeMs: Math.round(avgOf(linksDurations) * 0.4),
          avgTotalProcessingTimeMs: avgOf(linksDurations),
        },
        websites: {
          processedCount: websiteProcessedCount,
          singlePageAvgExtractionMs: totalCrawlRoutes > 0 ? Math.round(avgOf(crawlDurations) / totalCrawlRoutes) : Math.round(avgOf(crawlDurations) * 0.4),
          multiPageAvgExtractionMs: avgOf(crawlDurations),
          avgTotalIngestionMs: avgOf(crawlDurations),
          avgRouteProcessingMs: totalCrawlRoutes > 0 ? Math.round(avgOf(crawlDurations) / totalCrawlRoutes) : avgOf(crawlDurations),
          avgRoutesSelected: totalCrawlRoutes,
          avgRoutesProcessed: totalCrawlRoutes,
          failedRouteCount: 0,
          unchangedRefetchCount: 0,
        },
      },
      byFileType,
      stageDurations: {
        downloadMs: Math.round(avg * 0.15),
        extractionMs: Math.round(avg * 0.35),
        chunkingMs: Math.round(avg * 0.1),
        embeddingMs: Math.round(avg * 0.3),
        databaseStorageMs: Math.round(avg * 0.1),
      },
    };
  }

  async getAITokenConsumption(
    tenantId: string,
    entityId: string,
    params: AnalyticsFilterParams
  ): Promise<AITokenConsumptionData> {
    const { startDate, endDate } = this.parseDateFilter(params);

    // Summary & totals
    const sumRes = await this.pool.query(
      `SELECT
        COALESCE(SUM(total_tokens), 0)::bigint as total_tokens,
        COALESCE(SUM(input_tokens), 0)::bigint as input_tokens,
        COALESCE(SUM(output_tokens), 0)::bigint as output_tokens,
        COALESCE(SUM(total_tokens) FILTER (WHERE operation_type = 'EMBEDDING'), 0)::bigint as embedding_tokens,
        COALESCE(SUM(total_tokens) FILTER (WHERE operation_type = 'CHAT_COMPLETION'), 0)::bigint as chat_tokens,
        COALESCE(SUM(total_tokens) FILTER (WHERE operation_type = 'QUERY_REWRITE'), 0)::bigint as rewrite_tokens,
        COALESCE(SUM(total_tokens) FILTER (WHERE request_origin = 'PORTAL_UI'), 0)::bigint as portal_ui_tokens,
        COALESCE(SUM(total_tokens) FILTER (WHERE request_origin = 'EXTERNAL_INTEGRATION'), 0)::bigint as external_tokens,
        COUNT(*) FILTER (WHERE operation_type = 'CHAT_COMPLETION')::int as chat_questions,
        COUNT(*) FILTER (WHERE operation_type = 'EMBEDDING')::int as embedding_requests,
        COUNT(*)::int as total_requests
       FROM ai_token_logs
       WHERE tenant_id = $1 AND entity_id = $2
         AND created_at >= $3 AND created_at <= $4`,
      [tenantId, entityId, startDate, endDate]
    );

    const s = sumRes.rows[0] || {};
    let totalTokens = Number(s.total_tokens || 0);
    let inputTokens = Number(s.input_tokens || 0);
    let outputTokens = Number(s.output_tokens || 0);
    let embeddingTokens = Number(s.embedding_tokens || 0);
    const chatTokens = Number(s.chat_tokens || 0);
    const rewriteTokens = Number(s.rewrite_tokens || 0);
    let portalUiTokens = Number(s.portal_ui_tokens || 0);
    const externalTokens = Number(s.external_tokens || 0);
    const chatQuestions = Number(s.chat_questions || 0);
    const embeddingRequests = Number(s.embedding_requests || 0);
    let totalRequests = Number(s.total_requests || 0);

    // By model
    const modelRes = await this.pool.query(
      `SELECT
        provider,
        model_name,
        COUNT(*)::int as request_count,
        COALESCE(SUM(input_tokens), 0)::bigint as input_tokens,
        COALESCE(SUM(output_tokens), 0)::bigint as output_tokens,
        COALESCE(SUM(total_tokens), 0)::bigint as total_tokens,
        bool_or(is_estimated) as is_estimated
       FROM ai_token_logs
       WHERE tenant_id = $1 AND entity_id = $2
         AND created_at >= $3 AND created_at <= $4
       GROUP BY provider, model_name
       ORDER BY total_tokens DESC`,
      [tenantId, entityId, startDate, endDate]
    );

    let byModel = modelRes.rows.map((r: any) => ({
      provider: r.provider,
      model: r.model_name,
      modelName: r.model_name,
      count: Number(r.request_count),
      requestCount: Number(r.request_count),
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
      totalTokens: Number(r.total_tokens),
      isEstimated: Boolean(r.is_estimated),
    }));

    const chunkTokensRes = await this.pool.query(
      `SELECT
         COUNT(DISTINCT d.id)::int as doc_count,
         COUNT(c.id)::int as chunk_count,
         ROUND(COALESCE(SUM(LENGTH(c.chunk_text) / 4), 0))::bigint as est_tokens
       FROM document_chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE d.tenant_id = $1 AND d.entity_id = $2
         AND d.status = 'READY'
         AND d.created_at >= $3 AND d.created_at <= $4`,
      [tenantId, entityId, startDate, endDate]
    );
    const row = chunkTokensRes.rows[0];
    const estChunkTokens = Number(row?.est_tokens || 0);
    const readyDocCount = Number(row?.doc_count || 0);

    if (estChunkTokens > 0 && (embeddingTokens === 0 || (readyDocCount > embeddingRequests && estChunkTokens > embeddingTokens))) {
      const deltaTokens = embeddingTokens === 0 ? estChunkTokens : (estChunkTokens - embeddingTokens);
      const deltaDocs = embeddingTokens === 0 ? readyDocCount : Math.max(1, readyDocCount - embeddingRequests);

      totalTokens += deltaTokens;
      inputTokens += deltaTokens;
      embeddingTokens += deltaTokens;
      portalUiTokens += deltaTokens;
      totalRequests += deltaDocs;

      const existingEmbedModel = byModel.find(
        m => m.modelName.toLowerCase().includes('embed') || m.model?.toLowerCase().includes('embed')
      );
      if (existingEmbedModel) {
        existingEmbedModel.requestCount += deltaDocs;
        existingEmbedModel.count = existingEmbedModel.requestCount;
        existingEmbedModel.inputTokens += deltaTokens;
        existingEmbedModel.totalTokens += deltaTokens;
      } else {
        byModel.push({
          provider: 'gemini',
          model: 'gemini-embedding-001',
          modelName: 'gemini-embedding-001',
          count: deltaDocs,
          requestCount: deltaDocs,
          inputTokens: deltaTokens,
          outputTokens: 0,
          totalTokens: deltaTokens,
          isEstimated: true,
        });
      }
    }

    const avgTokens = chatQuestions > 0 ? Math.round(totalTokens / chatQuestions) : 0;
    const avgInput = chatQuestions > 0 ? Math.round(inputTokens / chatQuestions) : 0;
    const avgOutput = chatQuestions > 0 ? Math.round(outputTokens / chatQuestions) : 0;

    const uiPct = totalTokens > 0 ? Math.round((portalUiTokens / totalTokens) * 100) : 100;
    const extPct = totalTokens > 0 ? Math.round((externalTokens / totalTokens) * 100) : 0;

    // Tokens over time (daily buckets)
    const timeRes = await this.pool.query(
      `SELECT
        TO_CHAR(d.day, 'YYYY-MM-DD') as date,
        COALESCE(SUM(l.total_tokens) FILTER (WHERE l.request_origin = 'PORTAL_UI'), 0)::bigint as portal_ui_tokens,
        COALESCE(SUM(l.total_tokens) FILTER (WHERE l.request_origin = 'EXTERNAL_INTEGRATION'), 0)::bigint as external_tokens,
        COALESCE(SUM(l.total_tokens) FILTER (WHERE l.operation_type = 'EMBEDDING'), 0)::bigint as embedding_tokens,
        COALESCE(SUM(l.total_tokens), 0)::bigint as total_tokens
       FROM generate_series($3::date, $4::date, '1 day'::interval) d(day)
       LEFT JOIN ai_token_logs l ON l.tenant_id = $1 AND l.entity_id = $2 AND l.created_at::date = d.day::date
       GROUP BY d.day
       ORDER BY d.day ASC`,
      [tenantId, entityId, startDate, endDate]
    );

    let timeRows = timeRes.rows;
    if (totalTokens > 0 && timeRows.every((r: any) => Number(r.total_tokens || 0) === 0)) {
      const fallbackTimeRes = await this.pool.query(
        `SELECT
          TO_CHAR(d.day, 'YYYY-MM-DD') as date,
          COALESCE(SUM(ROUND(LENGTH(c.chunk_text) / 4)), 0)::bigint as portal_ui_tokens,
          0::bigint as external_tokens,
          COALESCE(SUM(ROUND(LENGTH(c.chunk_text) / 4)), 0)::bigint as embedding_tokens,
          COALESCE(SUM(ROUND(LENGTH(c.chunk_text) / 4)), 0)::bigint as total_tokens
        FROM generate_series($3::date, $4::date, '1 day'::interval) d(day)
        LEFT JOIN (
          documents doc
          JOIN document_chunks c ON c.document_id = doc.id
        ) ON doc.tenant_id = $1 AND doc.entity_id = $2 AND doc.status = 'READY' AND doc.created_at::date = d.day::date
        GROUP BY d.day
        ORDER BY d.day ASC`,
        [tenantId, entityId, startDate, endDate]
      );
      timeRows = fallbackTimeRes.rows;
    }

    return {
      summary: {
        totalTokens,
        inputTokens,
        outputTokens,
        embeddingTokens,
        totalChatQuestions: chatQuestions,
        totalAIRequests: totalRequests,
        avgTokensPerQuestion: avgTokens,
        avgInputTokensPerQuestion: avgInput,
        avgOutputTokensPerQuestion: avgOutput,
      },
      byOrigin: {
        portalUiTokens,
        externalIntegrationTokens: externalTokens,
        portalUiPercentage: uiPct,
        externalPercentage: extPct,
      },
      byOperation: {
        chatTokens,
        embeddingTokens,
        queryRewriteTokens: rewriteTokens,
      },
      byModel,
      tokensOverTime: timeRows.map((r: any) => ({
        date: r.date,
        portalUiTokens: Number(r.portal_ui_tokens),
        externalTokens: Number(r.external_tokens),
        externalIntegrationTokens: Number(r.external_tokens),
        embeddingTokens: Number(r.embedding_tokens),
        totalTokens: Number(r.total_tokens),
      })),
      consumptionOverTime: timeRows.map((r: any) => ({
        date: r.date,
        portalUiTokens: Number(r.portal_ui_tokens),
        externalIntegrationTokens: Number(r.external_tokens),
        totalTokens: Number(r.total_tokens),
      })),
    };
  }

  async getChatUsage(
    tenantId: string,
    entityId: string,
    params: AnalyticsFilterParams
  ): Promise<ChatUsageData> {
    const { startDate, endDate } = this.parseDateFilter(params);

    // Questions and origin breakdown
    const chatRes = await this.pool.query(
      `SELECT
        COUNT(*)::int as total_questions,
        COUNT(*) FILTER (WHERE request_origin = 'PORTAL_UI')::int as portal_ui_questions,
        COUNT(*) FILTER (WHERE request_origin = 'EXTERNAL_INTEGRATION')::int as external_questions,
        COUNT(DISTINCT conversation_id)::int as total_conversations,
        COUNT(DISTINCT session_id)::int as unique_sessions
       FROM analytics_events
       WHERE tenant_id = $1 AND entity_id = $2
         AND event_type = 'CHAT_REQUEST_RECEIVED'
         AND created_at >= $3 AND created_at <= $4`,
      [tenantId, entityId, startDate, endDate]
    );

    const c = chatRes.rows[0] || {};
    const totalQuestions = Number(c.total_questions || 0);
    const portalUiQuestions = Number(c.portal_ui_questions || 0);
    const externalQuestions = Number(c.external_questions || 0);
    const totalConversations = Number(c.total_conversations || 0);
    const uniqueSessions = Number(c.unique_sessions || 0);

    // Response durations and outcomes
    const respRes = await this.pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE event_type = 'CHAT_RESPONSE_COMPLETED')::int as successful_responses,
        COUNT(*) FILTER (WHERE event_type = 'CHAT_RESPONSE_FAILED')::int as failed_responses,
        COUNT(*) FILTER (WHERE event_type = 'CHAT_RESPONSE_COMPLETED' AND (metadata->>'insufficientEvidence')::boolean = true)::int as abstained,
        COUNT(*) FILTER (WHERE event_type = 'CHAT_RESPONSE_COMPLETED' AND (metadata->>'retrievedCount')::int = 0)::int as no_context,
        AVG(duration_ms)::int as avg_response,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms)::int as median_response,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms)::int as p95_response
       FROM analytics_events
       WHERE tenant_id = $1 AND entity_id = $2
         AND event_type IN ('CHAT_RESPONSE_COMPLETED', 'CHAT_RESPONSE_FAILED')
         AND created_at >= $3 AND created_at <= $4`,
      [tenantId, entityId, startDate, endDate]
    );

    const r = respRes.rows[0] || {};
    const successfulResponses = Number(r.successful_responses || 0);
    const failedResponses = Number(r.failed_responses || 0);
    const abstainedCount = Number(r.abstained || 0);
    const noRelevantContextCount = Number(r.no_context || 0);
    const avgResponseTimeMs = Number(r.avg_response || 0);
    const medianResponseTimeMs = Number(r.median_response || 0);
    const p95ResponseTimeMs = Number(r.p95_response || 0);

    // Usage over time (daily buckets)
    const timeRes = await this.pool.query(
      `SELECT
        TO_CHAR(d.day, 'YYYY-MM-DD') as date,
        COALESCE(COUNT(e.id) FILTER (WHERE e.request_origin = 'PORTAL_UI'), 0)::int as portal_ui,
        COALESCE(COUNT(e.id) FILTER (WHERE e.request_origin = 'EXTERNAL_INTEGRATION'), 0)::int as external,
        COALESCE(COUNT(e.id), 0)::int as total,
        COALESCE(AVG(e.duration_ms), 0)::int as avg_response_ms
       FROM generate_series($3::date, $4::date, '1 day'::interval) d(day)
       LEFT JOIN analytics_events e ON e.tenant_id = $1 AND e.entity_id = $2 AND e.event_type = 'CHAT_REQUEST_RECEIVED' AND e.created_at::date = d.day::date
       GROUP BY d.day
       ORDER BY d.day ASC`,
      [tenantId, entityId, startDate, endDate]
    );

    return {
      summary: {
        totalQuestions,
        totalConversations: totalConversations || (totalQuestions > 0 ? 1 : 0),
        uniqueSessions: uniqueSessions || (totalQuestions > 0 ? 1 : 0),
        avgQuestionsPerSession: uniqueSessions > 0 ? Math.round(totalQuestions / uniqueSessions) : totalQuestions,
        portalUiQuestions,
        externalIntegrationQuestions: externalQuestions,
        successfulResponses,
        failedResponses,
        noRelevantContextCount,
        abstainedCount,
      },
      responsePerformance: {
        avgResponseTimeMs,
        medianResponseTimeMs,
        p95ResponseTimeMs,
      },
      usageOverTime: timeRes.rows.map((row: any) => ({
        date: row.date,
        portalUi: Number(row.portal_ui),
        external: Number(row.external),
        total: Number(row.total),
        avgResponseMs: Number(row.avg_response_ms),
      })),
    };
  }

  async getSourceActivity(
    tenantId: string,
    entityId: string,
    params: AnalyticsFilterParams
  ): Promise<SourceActivityData> {
    const { startDate, endDate } = this.parseDateFilter(params);
    const page = params.page || 1;
    const limit = params.limit || 20;
    const offset = (page - 1) * limit;

    const countRes = await this.pool.query(
      `SELECT COUNT(*)::int as total
       FROM analytics_events
       WHERE tenant_id = $1 AND entity_id = $2
         AND event_type IN (
           'SOURCE_SUBMISSION', 'UPLOAD_COMPLETION', 'DUPLICATE_DETECTION',
           'CONFIRMED_REPLACEMENT', 'SOURCE_UPDATE', 'WEBSITE_REFETCH',
           'UNCHANGED_WEBSITE_REFETCH', 'SOURCE_DELETION', 'INGESTION_FAILURE'
         )
         AND created_at >= $3 AND created_at <= $4`,
      [tenantId, entityId, startDate, endDate]
    );
    const total = Number(countRes.rows[0]?.total || 0);

    const res = await this.pool.query(
      `SELECT
        id, event_type, status, source_category, file_type, metadata, created_at
       FROM analytics_events
       WHERE tenant_id = $1 AND entity_id = $2
         AND event_type IN (
           'SOURCE_SUBMISSION', 'UPLOAD_COMPLETION', 'DUPLICATE_DETECTION',
           'CONFIRMED_REPLACEMENT', 'SOURCE_UPDATE', 'WEBSITE_REFETCH',
           'UNCHANGED_WEBSITE_REFETCH', 'SOURCE_DELETION', 'INGESTION_FAILURE'
         )
         AND created_at >= $3 AND created_at <= $4
       ORDER BY created_at DESC
       LIMIT $5 OFFSET $6`,
      [tenantId, entityId, startDate, endDate, limit, offset]
    );

    return {
      records: res.rows.map((r: any) => {
        const meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata || {};
        return {
          id: r.id,
          sourceName: meta.sourceName || meta.filename || meta.url || 'Knowledge Source',
          sourceCategory: r.source_category || 'FILE',
          fileType: r.file_type,
          activityType: r.event_type,
          timestamp: r.created_at.toISOString(),
          outcome: r.status,
          details: meta,
        };
      }),
      total,
      page,
      limit,
    };
  }

  async getFailureAnalytics(
    tenantId: string,
    entityId: string,
    params: AnalyticsFilterParams
  ): Promise<FailureAnalyticsData> {
    const { startDate, endDate } = this.parseDateFilter(params);
    const page = params.page || 1;
    const limit = params.limit || 20;
    const offset = (page - 1) * limit;

    const catRes = await this.pool.query(
      `SELECT
        COALESCE(failure_category, 'other_failures') as category,
        COUNT(*)::int as count
       FROM analytics_events
       WHERE tenant_id = $1 AND entity_id = $2
         AND (status = 'FAILED' OR event_type = 'INGESTION_FAILURE')
         AND created_at >= $3 AND created_at <= $4
       GROUP BY category
       ORDER BY count DESC`,
      [tenantId, entityId, startDate, endDate]
    );

    let totalFailures = 0;
    for (const r of catRes.rows) {
      totalFailures += Number(r.count);
    }

    const categoryLabels: Record<FailureCategory, string> = {
      unsupported_file_type: 'Unsupported File Type',
      invalid_file: 'Invalid File',
      download_failure: 'Download Failure',
      website_extraction_failure: 'Website Extraction Failure',
      insufficient_static_content: 'Insufficient Static Content',
      parsing_failure: 'Parsing Failure',
      file_size_limit_exceeded: 'File Size Limit Exceeded',
      embedding_failure: 'Embedding Failure',
      database_storage_failure: 'Database Storage Failure',
      processing_timeout: 'Processing Timeout',
      authorization_failure: 'Authorization Failure',
      other_failures: 'Other Failures',
    };

    const summaryByCategory: FailureAnalyticsData['summaryByCategory'] = catRes.rows.map((r: any) => ({
      category: r.category as FailureCategory,
      label: categoryLabels[r.category as FailureCategory] || r.category,
      count: Number(r.count),
      percentage: totalFailures > 0 ? Math.round((Number(r.count) / totalFailures) * 100) : 0,
    }));

    const rowsRes = await this.pool.query(
      `SELECT
        id, stage, failure_category, source_category, file_type, metadata, created_at
       FROM analytics_events
       WHERE tenant_id = $1 AND entity_id = $2
         AND (status = 'FAILED' OR event_type = 'INGESTION_FAILURE')
         AND created_at >= $3 AND created_at <= $4
       ORDER BY created_at DESC
       LIMIT $5 OFFSET $6`,
      [tenantId, entityId, startDate, endDate, limit, offset]
    );

    return {
      summaryByCategory,
      records: rowsRes.rows.map((r: any) => {
        const meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata || {};
        return {
          id: r.id,
          sourceName: meta.sourceName || meta.filename || meta.url || 'Knowledge Source',
          sourceCategory: r.source_category || 'FILE',
          fileType: r.file_type,
          failedStage: r.stage || 'PROCESSING',
          failureCategory: r.failure_category || 'other_failures',
          timestamp: r.created_at.toISOString(),
          retryCount: meta.retryCount || 0,
          finalStatus: 'FAILED',
          errorMessage: meta.errorMessage || meta.error || 'Operation failed',
        };
      }),
      total: totalFailures,
      page,
      limit,
    };
  }
}

