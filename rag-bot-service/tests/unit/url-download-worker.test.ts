import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DownloadWorker } from '../../src/modules/downloader/download-worker.js';
import { MemoryDatabaseAdapter } from '../../src/adapters/database/memory.adapter.js';
import { LocalStorageAdapter } from '../../src/adapters/storage/local-storage.adapter.js';
import { LocalQueueAdapter } from '../../src/adapters/queue/local-queue.adapter.js';
import { generateUuid } from '../../src/shared/utils.js';

describe('Dedicated URL Download Worker (Criteria 10, 11, 12)', () => {
  let db: MemoryDatabaseAdapter;
  let storage: LocalStorageAdapter;
  let queue: LocalQueueAdapter;
  let worker: DownloadWorker;

  const tenantId = generateUuid();
  const entityId = generateUuid();
  const jobId = generateUuid();
  const documentId = generateUuid();

  beforeEach(async () => {
    db = new MemoryDatabaseAdapter();
    await db.init();
    storage = new LocalStorageAdapter('memory-test-storage');
    queue = new LocalQueueAdapter(false);
    worker = new DownloadWorker(db, storage, queue);

    // Setup tenant, entity, job and jobDocument in DB
    await db.createTenant({ id: tenantId, name: 'Acme Corp', slug: 'acme' });
    await db.createEntity({
      id: entityId,
      tenantId,
      name: 'Engineering Portal',
      slug: 'engineering',
      portalUrl: 'https://acme.org/engineering',
      isPublic: true,
    });

    await db.createIngestionJob({
      id: jobId,
      tenantId,
      entityId,
      totalDocuments: 1,
      sourceType: 'URL_IMPORT',
    });

    await db.createJobDocument(tenantId, jobId, documentId, {
      sourceUrl: 'https://example.com/spec.pdf',
      stage: 'QUEUED_FOR_DOWNLOAD',
    });
  });

  it('should securely download file, store in storage, and transition stage to UPLOADED_TO_S3', async () => {
    // Mock the internal downloader
    const pdfBytes = Buffer.from('%PDF-1.4 mock technical spec');
    vi.spyOn((worker as any).downloader, 'download').mockResolvedValueOnce({
      buffer: pdfBytes,
      mimeType: 'application/pdf',
      filename: 'spec.pdf',
      sizeBytes: pdfBytes.length,
      finalUrl: 'https://example.com/spec.pdf',
    });

    const uploadSpy = vi.spyOn(storage, 'uploadFile').mockResolvedValueOnce(undefined);

    await worker.processDownloadJob({
      tenantId,
      entityId,
      jobId,
      documentId,
      url: 'https://example.com/spec.pdf',
      portfolioUrl: 'https://acme.org/engineering',
    });

    // Verify file was uploaded
    expect(uploadSpy).toHaveBeenCalledWith(
      'acme.org/engineering/spec.pdf',
      pdfBytes,
      'application/pdf'
    );

    // Verify stage in DB updated to UPLOADED_TO_S3
    const jobDoc = await db.getJobDocumentByDocumentId(documentId);
    expect(jobDoc?.stage).toBe('UPLOADED_TO_S3');

    // Verify document was registered
    const doc = await db.getDocumentById(tenantId, entityId, documentId);
    expect(doc).not.toBeNull();
    expect(doc?.originalFilename).toBe('spec.pdf');
    expect(doc?.objectKey).toBe('acme.org/engineering/spec.pdf');
  });

  it('should be idempotent and skip download if document is already READY or UPLOADED_TO_S3 (Criteria 12)', async () => {
    // Mark document as already UPLOADED_TO_S3
    await db.updateJobDocumentStage(tenantId, jobId, documentId, 'UPLOADED_TO_S3');

    const downloadSpy = vi.spyOn((worker as any).downloader, 'download');

    await worker.processDownloadJob({
      tenantId,
      entityId,
      jobId,
      documentId,
      url: 'https://example.com/spec.pdf',
    });

    // Downloader should NOT be invoked
    expect(downloadSpy).not.toHaveBeenCalled();
  });

  it('should handle download failure and record DOWNLOAD_FAILED stage with safe error message (Criteria 19)', async () => {
    vi.spyOn((worker as any).downloader, 'download').mockRejectedValueOnce(
      new Error('Remote server returned HTTP 404')
    );

    await expect(
      worker.processDownloadJob({
        tenantId,
        entityId,
        jobId,
        documentId,
        url: 'https://example.com/missing.pdf',
      })
    ).rejects.toThrow('HTTP 404');

    const jobDoc = await db.getJobDocumentByDocumentId(documentId);
    expect(jobDoc?.stage).toBe('DOWNLOAD_FAILED');
    expect(jobDoc?.errorMessage).toContain('HTTP 404');
  });
});

