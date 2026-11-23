import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryDatabaseAdapter } from '../../src/adapters/database/memory.adapter.js';
import { LocalStorageAdapter } from '../../src/adapters/storage/local-storage.adapter.js';
import { LocalQueueAdapter } from '../../src/adapters/queue/local-queue.adapter.js';
import { MockAIAdapter } from '../../src/adapters/ai/mock-ai.adapter.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { DocumentsService } from '../../src/modules/documents/documents.service.js';
import { ExtractionService } from '../../src/modules/extraction/extraction.service.js';
import { ChunkingService } from '../../src/modules/chunking/chunking.service.js';
import { EmbeddingsService } from '../../src/modules/embeddings/embeddings.service.js';
import { RetrievalService } from '../../src/modules/retrieval/retrieval.service.js';
import { GenerationService } from '../../src/modules/generation/generation.service.js';
import { IngestionService } from '../../src/modules/ingestion/ingestion.service.js';
import { PortfoliosService } from '../../src/modules/portfolios/portfolios.service.js';
import { AnalyticsService } from '../../src/modules/analytics/analytics.service.js';
import { AuthContext } from '../../src/types/index.js';
import path from 'path';

describe('Portal-Level Analytics and AI Token Attribution (Phases 1-6, 8-9)', () => {
  let db: MemoryDatabaseAdapter;
  let storage: LocalStorageAdapter;
  let queue: LocalQueueAdapter;
  let ai: MockAIAdapter;
  let authService: AuthService;
  let docsService: DocumentsService;
  let extractionService: ExtractionService;
  let chunkingService: ChunkingService;
  let embeddingsService: EmbeddingsService;
  let retrievalService: RetrievalService;
  let generationService: GenerationService;
  let ingestionService: IngestionService;
  let portfoliosService: PortfoliosService;
  let analyticsService: AnalyticsService;

  // Portal A (Tenant A)
  const tenantAId = '11111111-1111-1111-1111-111111111111';
  const portalAId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const userAId = 'a1e0c4e7-0001-4000-8000-000000000001';

  // Portal B (Tenant B)
  const tenantBId = '22222222-2222-2222-2222-222222222222';
  const portalBId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const userBId = 'b1e0c4e7-0002-4000-8000-000000000002';

  let ownerAAuth: AuthContext;
  let ownerBAuth: AuthContext;
  let externalVisitorAuth: AuthContext;

  beforeEach(async () => {
    db = new MemoryDatabaseAdapter();
    const storageDir = path.join(process.cwd(), 'test-analytics-storage');
    storage = new LocalStorageAdapter(storageDir);
    queue = new LocalQueueAdapter(true);
    ai = new MockAIAdapter(1536);

    authService = new AuthService(db, 'test-secret-key-12345');
    docsService = new DocumentsService(db, storage);
    extractionService = new ExtractionService();
    chunkingService = new ChunkingService(500, 50);
    embeddingsService = new EmbeddingsService(ai);
    retrievalService = new RetrievalService(db, embeddingsService, 6, 60, 0.005);
    generationService = new GenerationService(ai);
    analyticsService = new AnalyticsService(db, authService);

    ingestionService = new IngestionService(
      db,
      storage,
      queue,
      docsService,
      extractionService,
      chunkingService,
      embeddingsService,
      analyticsService
    );

    portfoliosService = new PortfoliosService(
      db,
      docsService,
      ingestionService,
      storage,
      retrievalService,
      generationService,
      analyticsService
    );

    // Seed Tenant A & Portal A
    await db.createTenant({ id: tenantAId, name: 'Acme Systems', slug: 'acme' });
    await db.createUser({ id: userAId, email: 'alex@acme.example.com', name: 'Alex' });
    await db.createTenantMembership(tenantAId, userAId, 'owner');
    await db.createEntity({
      id: portalAId,
      tenantId: tenantAId,
      name: 'Acme Portal A',
      slug: 'acme-portal-a',
      portfolioUrl: 'https://acme.example.com/portal-a',
      isPublic: true,
    });

    // Seed Tenant B & Portal B
    await db.createTenant({ id: tenantBId, name: 'Beta Global', slug: 'beta' });
    await db.createUser({ id: userBId, email: 'jane@beta.example.com', name: 'Jane' });
    await db.createTenantMembership(tenantBId, userBId, 'owner');
    await db.createEntity({
      id: portalBId,
      tenantId: tenantBId,
      name: 'Beta Portal B',
      slug: 'beta-portal-b',
      portfolioUrl: 'https://beta.example.com/portal-b',
      isPublic: true,
    });

    ownerAAuth = {
      userId: userAId,
      tenantId: tenantAId,
      roles: ['owner'],
      isSuperadmin: false,
      isPublicVisitor: false,
    };

    ownerBAuth = {
      userId: userBId,
      tenantId: tenantBId,
      roles: ['owner'],
      isSuperadmin: false,
      isPublicVisitor: false,
    };

    externalVisitorAuth = {
      roles: ['visitor'],
      isSuperadmin: false,
      isPublicVisitor: true,
    };
  });

  describe('1. Cross-Portal AI Token Attribution & Isolation (Phase 4 & 4.5)', () => {
    it('should attribute tokens to Portal A when external client queries Portal A endpoint', async () => {
      // Seed a document into Portal A so retrieval finds evidence
      const jobRes = await portfoliosService.submitIngestionJob(ownerAAuth, portalAId, [
        {
          filename: 'architecture.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('Acme Architecture overview: Microservices deployed on Kubernetes with PostgreSQL.'),
          isPublic: true,
        },
      ]);

      // Process document to READY
      const jobDocs = await db.getJobDocuments(tenantAId, jobRes.jobId);
      await ingestionService.processSingleDocument(tenantAId, portalAId, jobRes.jobId, jobDocs[0].documentId);

      // External client sends question to Portal A's endpoint (simulated external visitor)
      const mockExternalReq = {
        headers: { 'x-request-origin': 'external_integration' },
      } as any;

      const answerResA = await portfoliosService.askQuestion(
        externalVisitorAuth,
        portalAId,
        'Tell me about Acme Architecture',
        mockExternalReq
      );

      expect(answerResA.answer).toBeTruthy();
      expect(answerResA.portfolioId).toBe(portalAId);

      // Fetch Portal A Token Consumption
      const tokensA = await analyticsService.getAITokenConsumption(ownerAAuth, portalAId, { period: '30d' });
      expect(tokensA.summary.totalTokens).toBeGreaterThan(0);
      expect(tokensA.byOrigin.externalIntegrationTokens).toBe(tokensA.byOperation.chatTokens);
      expect(tokensA.byOrigin.portalUiTokens).toBe(tokensA.byOperation.embeddingTokens);
      expect(tokensA.summary.totalChatQuestions).toBe(1);

      // Verify Portal B cannot see Portal A's usage (Strict Cross-Portal Isolation)
      const tokensB = await analyticsService.getAITokenConsumption(ownerBAuth, portalBId, { period: '30d' });
      expect(tokensB.summary.totalTokens).toBe(0);
      expect(tokensB.summary.totalChatQuestions).toBe(0);
    });

    it('should attribute tokens to Portal B when external client queries Portal B endpoint and keep them isolated', async () => {
      // Seed document into Portal B
      const jobResB = await portfoliosService.submitIngestionJob(ownerBAuth, portalBId, [
        {
          filename: 'clinical-research.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('Beta Global clinical trial Phase III results for oncology immunotherapies.'),
          isPublic: true,
        },
      ]);
      const jobDocsB = await db.getJobDocuments(tenantBId, jobResB.jobId);
      await ingestionService.processSingleDocument(tenantBId, portalBId, jobResB.jobId, jobDocsB[0].documentId);

      // External client asks Portal B
      const mockExternalReq = {
        headers: { 'x-request-origin': 'external_integration' },
      } as any;

      await portfoliosService.askQuestion(
        externalVisitorAuth,
        portalBId,
        'What are the Phase III results?',
        mockExternalReq
      );

      // Verify Portal B has recorded usage
      const tokensB = await analyticsService.getAITokenConsumption(ownerBAuth, portalBId, { period: '30d' });
      expect(tokensB.summary.totalTokens).toBeGreaterThan(0);
      expect(tokensB.byOrigin.externalIntegrationTokens).toBe(tokensB.byOperation.chatTokens);
      expect(tokensB.byOrigin.portalUiTokens).toBe(tokensB.byOperation.embeddingTokens);

      // Verify Portal A does not see Portal B's usage
      const tokensA = await analyticsService.getAITokenConsumption(ownerAAuth, portalAId, { period: '30d' });
      expect(tokensA.summary.totalTokens).toBe(0);
    });

    it('should distinguish Portal UI chatbot questions from External Integration questions', async () => {
      // Seed document into Portal A
      const jobRes = await portfoliosService.submitIngestionJob(ownerAAuth, portalAId, [
        {
          filename: 'system-specs.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('System specifications: High availability RAG with 99.9% uptime SLA.'),
          isPublic: true,
        },
      ]);
      const jobDocs = await db.getJobDocuments(tenantAId, jobRes.jobId);
      await ingestionService.processSingleDocument(tenantAId, portalAId, jobRes.jobId, jobDocs[0].documentId);

      // 1. Question from Portal UI (Logged in owner A without external headers)
      const portalUiReq = { headers: {} } as any;
      await portfoliosService.askQuestion(
        ownerAAuth,
        portalAId,
        'What is the SLA?',
        portalUiReq
      );

      // 2. Question from External Integration (External visitor)
      const externalReq = { headers: { 'x-persona-origin': 'external_integration' } } as any;
      await portfoliosService.askQuestion(
        externalVisitorAuth,
        portalAId,
        'What is the system uptime?',
        externalReq
      );

      // Inspect Chat Usage Breakdown
      const chatUsage = await analyticsService.getChatUsage(ownerAAuth, portalAId, { period: '30d' });
      expect(chatUsage.summary.totalQuestions).toBe(2);
      expect(chatUsage.summary.portalUiQuestions).toBe(1);
      expect(chatUsage.summary.externalIntegrationQuestions).toBe(1);

      // Inspect Token Origin Breakdown
      const tokenUsage = await analyticsService.getAITokenConsumption(ownerAAuth, portalAId, { period: '30d' });
      expect(tokenUsage.byOrigin.portalUiTokens).toBeGreaterThan(0);
      expect(tokenUsage.byOrigin.externalIntegrationTokens).toBeGreaterThan(0);
      expect(tokenUsage.byOrigin.portalUiPercentage + tokenUsage.byOrigin.externalPercentage).toBe(100);
    });

    it('should prevent Portal A from accessing Portal B analytics data (Cross-Tenant Authorization)', async () => {
      // Owner A attempts to query Portal B's analytics overview
      await expect(
        analyticsService.getOverview(ownerAAuth, portalBId, { period: '30d' })
      ).rejects.toThrow();
    });
  });

  describe('2. Source Lifecycle and Ingestion Outcomes (Phase 2 & 2.3)', () => {
    it('should calculate ingestion outcomes with mutually exclusive categories for pie/donut charts', async () => {
      // 1. Submit 2 files
      const jobRes = await portfoliosService.submitIngestionJob(ownerAAuth, portalAId, [
        {
          filename: 'doc1.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('Document 1 contents for testing.'),
          isPublic: true,
        },
        {
          filename: 'doc2.md',
          mimeType: 'text/markdown',
          buffer: Buffer.from('# Document 2 contents for testing.'),
          isPublic: true,
        },
      ]);

      const jobDocs = await db.getJobDocuments(tenantAId, jobRes.jobId);

      // Process doc1 to READY
      await ingestionService.processSingleDocument(tenantAId, portalAId, jobRes.jobId, jobDocs[0].documentId);

      // Fail doc2
      await db.updateDocumentStatus(tenantAId, jobDocs[1].documentId, 'FAILED', 'Corrupt document format');

      const sourceAnalytics = await analyticsService.getSourceAnalytics(ownerAAuth, portalAId, { period: '30d' });

      // Verify outcomes for Pie/Donut Chart
      expect(sourceAnalytics.ingestionOutcomes).toBeDefined();
      expect(sourceAnalytics.ingestionOutcomes.successful).toBe(1);
      expect(sourceAnalytics.ingestionOutcomes.failed).toBe(1);
      expect(sourceAnalytics.ingestionOutcomes.totalOperations).toBe(2);

      // Verify category distribution
      expect(sourceAnalytics.categoryDistribution.files).toBe(2);
      expect(sourceAnalytics.categoryDistribution.links).toBe(0);
      expect(sourceAnalytics.categoryDistribution.websites).toBe(0);

      // Verify file type breakdown
      const txtType = sourceAnalytics.fileTypeDistribution.find(f => f.fileType === 'txt');
      const mdType = sourceAnalytics.fileTypeDistribution.find(f => f.fileType === 'markdown');
      expect(txtType).toBeDefined();
      expect(mdType).toBeDefined();
    });

    it('should count exactly 1 parent website source when a crawl with 8 routes is uploaded, not 8 separate sources', async () => {
      // Create a fresh portal for Portal C to test website crawling separation
      const portalC = await db.createEntity({
        id: '22222222-2222-2222-2222-222222222222',
        tenantId: tenantAId,
        name: 'Portal C Crawl Test',
        slug: 'portal-c-crawl',
        isPublic: true,
      });

      // Create a crawl job for portal C (1 root website URL)
      const crawlJobId = '33333333-3333-3333-3333-333333333333';
      await db.createCrawlJob({
        id: crawlJobId,
        tenantId: tenantAId,
        entityId: portalC.id,
        rootUrl: 'https://docs.example.com',
        config: { maxPages: 10 },
      });

      // Simulate discovering and ingesting 8 routes/child pages for this crawl job
      for (let i = 1; i <= 8; i++) {
        const routeDocId = `44444444-4444-4444-4444-44444444440${i}`;
        await db.createDocument({
          id: routeDocId,
          tenantId: tenantAId,
          entityId: portalC.id,
          originalFilename: `docs_example_com_page_${i}.md`,
          mimeType: 'text/markdown',
          sizeBytes: 1024,
          contentHash: `hash_page_${i}`,
          objectKey: `crawls/docs_example_com_page_${i}.md`,
          isPublic: true,
          status: 'READY',
          sourceType: 'WEBSITE_CRAWL',
        });

        await db.createCrawlPages([{
          tenantId: tenantAId,
          entityId: portalC.id,
          crawlJobId,
          documentId: routeDocId,
          originalUrl: `https://docs.example.com/route-${i}`,
          normalizedUrl: `https://docs.example.com/route-${i}`,
          depth: 1,
        }]);
      }

      // Mark crawl job as completed
      await db.updateCrawlJob(tenantAId, crawlJobId, {
        status: 'completed',
        completedCount: 8,
        discoveredCount: 8,
      });

      // Fetch analytics for Portal C
      const sourceAnalytics = await analyticsService.getSourceAnalytics(ownerAAuth, portalC.id, { period: '30d' });
      const overview = await analyticsService.getOverview(ownerAAuth, portalC.id, { period: '30d' });

      // 1. Total unique sources must be 1, NOT 8!
      expect(sourceAnalytics.uniqueSources).toBe(1);
      expect(overview.totalSources).toBe(1);

      // 2. Category distribution must show 1 website, 0 files, 0 links
      expect(sourceAnalytics.categoryDistribution.websites).toBe(1);
      expect(sourceAnalytics.categoryDistribution.files).toBe(0);
      expect(sourceAnalytics.categoryDistribution.links).toBe(0);
      expect(sourceAnalytics.categoryDistribution.total).toBe(1);

      // 3. Discovered routes must track the 8 child pages
      expect(sourceAnalytics.discoveredRoutes).toBe(8);

      // 4. Ingestion outcomes should report 1 successful parent operation
      expect(sourceAnalytics.ingestionOutcomes.successful).toBe(1);
      expect(sourceAnalytics.ingestionOutcomes.totalOperations).toBe(1);

      // 5. File type distribution must NOT include the 8 internal markdown crawl files
      expect(sourceAnalytics.fileTypeDistribution.length).toBe(0);

      // 6. Processing Performance must count exactly 1 website extraction (not 8)
      const perf = await analyticsService.getProcessingPerformance(ownerAAuth, portalC.id, { period: '30d' });
      expect(perf.overall.sourcesProcessed).toBe(1);
      expect(perf.byCategory.websites.processedCount).toBe(1);
      expect(perf.byCategory.websites.avgRoutesProcessed).toBe(8);
      expect(perf.byCategory.files.processedCount).toBe(0);
      expect(perf.byCategory.links.totalProcessed).toBe(0);
      expect(perf.byFileType.find(f => f.fileType === 'markdown')).toBeUndefined();
      expect(perf.byFileType.find(f => f.fileType === 'website')?.processedCount).toBe(1);

      // 7. AI Token Consumption must have model and count defined on all byModel entries
      const tokens = await analyticsService.getAITokenConsumption(ownerAAuth, portalC.id, { period: '30d' });
      expect(tokens.consumptionOverTime).toBeDefined();
      for (const m of tokens.byModel) {
        expect(m.model).toBeDefined();
        expect(typeof m.count).toBe('number');
      }
    });

    it('should filter analytics metrics accurately according to the date range filter', async () => {
      const portalD = await db.createEntity({
        id: '55555555-5555-5555-5555-555555555555',
        tenantId: tenantAId,
        name: 'Portal D Range Test',
        slug: 'portal-d-range',
        isPublic: true,
      });

      // 1. Create a document from 40 days ago
      const oldDoc = await db.createDocument({
        id: '66666666-6666-6666-6666-666666666601',
        tenantId: tenantAId,
        entityId: portalD.id,
        originalFilename: 'ancient-archive.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        contentHash: 'hash_old_pdf',
        objectKey: 'ancient-archive.pdf',
        isPublic: true,
        status: 'READY',
      });
      // Override createdAt to 40 days ago
      const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      (oldDoc as any).createdAt = fortyDaysAgo;
      if ((db as any).pool) {
        await (db as any).pool.query(
          'UPDATE documents SET created_at = $1 WHERE id = $2',
          [fortyDaysAgo, oldDoc.id]
        );
      }

      // 2. Create a document uploaded today
      await db.createDocument({
        id: '66666666-6666-6666-6666-666666666602',
        tenantId: tenantAId,
        entityId: portalD.id,
        originalFilename: 'today-report.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes: 1024,
        contentHash: 'hash_today_docx',
        objectKey: 'today-report.docx',
        isPublic: true,
        status: 'READY',
      });

      // Query with period: 'today'
      const todayOverview = await analyticsService.getOverview(ownerAAuth, portalD.id, { period: 'today' });
      const todaySources = await analyticsService.getSourceAnalytics(ownerAAuth, portalD.id, { period: 'today' });

      expect(todayOverview.totalSources).toBe(1);
      expect(todaySources.uniqueSources).toBe(1);
      expect(todaySources.categoryDistribution.files).toBe(1);
      expect(todaySources.fileTypeDistribution[0]?.fileType).toBe('docx');

      // Query with period: '90d' (should include both documents)
      const allTimeOverview = await analyticsService.getOverview(ownerAAuth, portalD.id, { period: '90d' });
      const allTimeSources = await analyticsService.getSourceAnalytics(ownerAAuth, portalD.id, { period: '90d' });

      expect(allTimeOverview.totalSources).toBe(2);
      expect(allTimeSources.uniqueSources).toBe(2);
      expect(allTimeSources.categoryDistribution.files).toBe(2);

      // Query with period: 'custom' targeting 45 days ago to 35 days ago (should include only the ancient archive)
      const fortyFiveDaysAgoStr = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const thirtyFiveDaysAgoStr = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const customSources = await analyticsService.getSourceAnalytics(ownerAAuth, portalD.id, {
        period: 'custom',
        startDate: fortyFiveDaysAgoStr,
        endDate: thirtyFiveDaysAgoStr,
      });

      expect(customSources.uniqueSources).toBe(1);
      expect(customSources.fileTypeDistribution[0]?.fileType).toBe('pdf');
    });
  });

  describe('3. Processing Performance Analytics (Phase 3)', () => {
    it('should calculate end-to-end processing time and file type comparisons without exposing technical infrastructure metrics', async () => {
      const jobRes = await portfoliosService.submitIngestionJob(ownerAAuth, portalAId, [
        {
          filename: 'report.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('Quarterly performance report text.'),
          isPublic: true,
        },
      ]);
      const jobDocs = await db.getJobDocuments(tenantAId, jobRes.jobId);
      await ingestionService.processSingleDocument(tenantAId, portalAId, jobRes.jobId, jobDocs[0].documentId);

      const perf = await analyticsService.getProcessingPerformance(ownerAAuth, portalAId, { period: '30d' });

      expect(perf.overall.sourcesProcessed).toBe(1);
      expect(perf.overall.avgProcessingTimeMs).toBeGreaterThanOrEqual(0);
      expect(perf.byCategory.files.processedCount).toBe(1);
      expect(perf.stageDurations.downloadMs).toBeGreaterThanOrEqual(0);
      expect(perf.stageDurations.extractionMs).toBeGreaterThanOrEqual(0);
      expect(perf.stageDurations.chunkingMs).toBeGreaterThanOrEqual(0);
      expect(perf.stageDurations.embeddingMs).toBeGreaterThanOrEqual(0);
      expect(perf.stageDurations.databaseStorageMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('4. Failure Analytics & Source Activity (Phase 2.4, 5, 6)', () => {
    it('should classify failures into business-friendly categories and log detailed failure table records', async () => {
      // Record a simulated failure event
      await analyticsService.recordEvent({
        tenantId: tenantAId,
        entityId: portalAId,
        eventType: 'INGESTION_FAILURE',
        status: 'FAILED',
        sourceCategory: 'FILE',
        fileType: 'pdf',
        stage: 'DOWNLOAD',
        failureCategory: 'download_failure',
        metadata: {
          errorMessage: 'Connection timed out while fetching document',
          filename: 'broken-link.pdf',
        },
      });

      const failures = await analyticsService.getFailureAnalytics(ownerAAuth, portalAId, { period: '30d' });
      expect(failures.total).toBe(1);
      expect(failures.summaryByCategory.length).toBeGreaterThan(0);
      expect(failures.summaryByCategory[0].category).toBe('download_failure');
      expect(failures.records[0].sourceName).toBe('broken-link.pdf');
      expect(failures.records[0].failedStage).toBe('DOWNLOAD');

      // Check source activity table
      const activity = await analyticsService.getSourceActivity(ownerAAuth, portalAId, { period: '30d' });
      expect(activity.total).toBeGreaterThanOrEqual(1);
      const failRecord = activity.records.find(r => r.activityType === 'INGESTION_FAILURE');
      expect(failRecord).toBeDefined();
    });

    it('should remain resilient and not block source operations if analytics recording fails', async () => {
      // Mock db.recordAnalyticsEvent to throw
      vi.spyOn(db, 'recordAnalyticsEvent').mockRejectedValueOnce(new Error('Simulated database transient error'));

      // Ingestion and chat should still execute cleanly without throwing
      const result = await analyticsService.recordEvent({
        tenantId: tenantAId,
        entityId: portalAId,
        eventType: 'SOURCE_SUBMISSION',
      });

      // Should return null and not crash
      expect(result).toBeNull();
    });
  });
});