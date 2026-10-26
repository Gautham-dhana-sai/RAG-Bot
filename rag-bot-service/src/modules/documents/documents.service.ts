import { IDatabaseAdapter } from '../../adapters/database/database.interface.js';
import { IStorageAdapter } from '../../adapters/storage/storage.interface.js';
import { Document, DocumentVersion } from '../../types/index.js';
import { computeSha256 } from '../../shared/utils.js';
import { NotFoundError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';

/**
 * Convert a portfolio URL (or slug) into a clean folder path prefix.
 * Example:
 *   getPortfolioFolderPrefix("https://alexchen.cloud/portfolio")
 *   => "alexchen.cloud/portfolio"
 */
export function getPortfolioFolderPrefix(urlOrPrefix: string): string {
  let folder = urlOrPrefix.trim();
  // Strip http:// or https://
  folder = folder.replace(/^https?:\/\//i, '');
  // Strip query parameters and anchors
  folder = folder.split('?')[0].split('#')[0];
  // Trim leading and trailing slashes
  folder = folder.replace(/^\/+|\/+$/g, '');

  // Sanitize path segments while preserving forward slashes for folder structure
  return folder
    .split('/')
    .map(seg => seg.replace(/[^a-zA-Z0-9._-]/g, '_'))
    .filter(Boolean)
    .join('/');
}

/**
 * Convert a portfolio URL (or slug) into a clean S3 folder path with the file inside.
 * Example:
 *   buildS3ObjectKey("https://alexchen.cloud/portfolio", "sample-resume.txt")
 *   => "alexchen.cloud/portfolio/sample-resume.txt"
 */
export function buildS3ObjectKey(urlOrPrefix: string, filename: string): string {
  const cleanFolder = getPortfolioFolderPrefix(urlOrPrefix);
  const cleanFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleanFolder ? `${cleanFolder}/${cleanFilename}` : cleanFilename;
}

export class DocumentsService {
  constructor(
    private db: IDatabaseAdapter,
    private storage: IStorageAdapter
  ) {}

  async getDocument(tenantId: string, entityId: string, documentId: string): Promise<Document> {
    const doc = await this.db.getDocumentById(tenantId, entityId, documentId);
    if (!doc) throw new NotFoundError('Document', documentId);
    return doc;
  }

  async listDocuments(tenantId: string, entityId: string): Promise<Document[]> {
    return this.db.getDocumentsByEntity(tenantId, entityId);
  }

  async registerAndStoreFile(params: {
    tenantId: string;
    entityId: string;
    filename: string;
    mimeType: string;
    buffer: Buffer;
    isPublic?: boolean;
    portfolioUrl?: string;
  }): Promise<{ document: Document; isExisting: boolean; version?: DocumentVersion }> {
    const { tenantId, entityId, filename, mimeType, buffer, isPublic = false } = params;
    const contentHash = computeSha256(buffer);
    const sizeBytes = buffer.length;

    // Check if duplicate document already exists in this entity
    const existing = await this.db.getDocumentByHash(entityId, contentHash);
    if (existing) {
      let isStubbed = false;
      if (existing.mimeType && existing.mimeType.startsWith('image/')) {
        try {
          if (typeof (this.db as any).hasPlaceholderChunks === 'function') {
            isStubbed = await (this.db as any).hasPlaceholderChunks(tenantId, existing.id);
          }
        } catch {}
      }

      if (isStubbed) {
        logger.info(`Document with hash ${contentHash} has legacy placeholder stub. Setting status to PENDING for live OCR extraction.`);
        await this.db.updateDocumentStatus(tenantId, existing.id, 'PENDING');
        existing.status = 'PENDING';
      } else {
        logger.info(`Idempotent upload: document with hash ${contentHash} already exists (id: ${existing.id})`);
      }
      return { document: existing, isExisting: true };
    }

    // Determine S3 folder prefix: use provided portfolioUrl or query entity from DB
    let prefix = params.portfolioUrl;
    if (!prefix) {
      const entity = await this.db.getEntityById(tenantId, entityId);
      prefix = entity?.portfolioUrl || entity?.slug || `${tenantId}/${entityId}`;
    }

    // Generate storage object key with folder level for the URL and the filename inside
    const objectKey = buildS3ObjectKey(prefix, filename);

    // Upload to storage (S3 or local storage)
    await this.storage.uploadFile(objectKey, buffer, mimeType);
    logger.info(`Stored document in storage: key="${objectKey}" (size: ${sizeBytes} bytes)`);

    // Save document record
    const document = await this.db.createDocument({
      tenantId,
      entityId,
      originalFilename: filename,
      mimeType,
      sizeBytes,
      contentHash,
      objectKey,
      isPublic,
      status: 'PENDING',
    });

    // Save version 1 record
    const version = await this.db.createDocumentVersion({
      tenantId,
      entityId,
      documentId: document.id,
      versionNumber: 1,
      contentHash,
      objectKey,
      sizeBytes,
    });

    return { document, isExisting: false, version };
  }

  async deleteDocument(tenantId: string, entityId: string, documentId: string): Promise<boolean> {
    const doc = await this.getDocument(tenantId, entityId, documentId);
    await this.storage.deleteFile(doc.objectKey);
    return this.db.deleteDocument(tenantId, entityId, documentId);
  }
}
