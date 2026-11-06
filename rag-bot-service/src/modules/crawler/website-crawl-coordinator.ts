import * as cheerio from 'cheerio';
import { URL } from 'url';
import { IDatabaseAdapter } from '../../adapters/database/database.interface.js';
import { IQueueAdapter } from '../../adapters/queue/queue.interface.js';
import { CrawlConfig, CrawlJob, CrawlPage } from '../../types/index.js';
import { normalizeUrl, isAllowedOrigin, isExcludedUrl } from './url-normalizer.js';
import { RobotsParser, RobotsInfo } from './robots-parser.js';
import { SitemapParser } from './sitemap-parser.js';
import { validateUrlForSsrf } from '../../shared/ssrf-validator.js';
import { buildS3ObjectKey } from '../documents/documents.service.js';
import { computeSha256, generateUuid } from '../../shared/utils.js';
import { logger } from '../../shared/logger.js';
import { env } from '../../config/env.js';

export interface DiscoveryResult {
  crawlJobId: string;
  rootUrl: string;
  discoveredCount: number;
  queuedCount: number;
  pages: Array<{ url: string; depth: number; source: 'root' | 'sitemap' | 'link' }>;
}

export class WebsiteCrawlCoordinator {
  private robotsParser: RobotsParser;
  private sitemapParser: SitemapParser;

  constructor(
    private db: IDatabaseAdapter,
    private queue: IQueueAdapter
  ) {
    this.robotsParser = new RobotsParser(8000);
    this.sitemapParser = new SitemapParser({ timeoutMs: 10000 });
  }

  /**
   * Executes multi-page discovery for a crawl job:
   * 1. Fetches and respects robots.txt (sitemaps, crawl-delay, disallow paths).
   * 2. Discovers URLs from public sitemaps.
   * 3. Discovers internal links from static HTML.
   * 4. Enforces same-origin boundary, exclusion filters, max pages, and max depth.
   * 5. Persists crawl_pages and enqueues bounded page jobs to URL download queue.
   */
  async executeDiscovery(params: {
    tenantId: string;
    entityId: string;
    crawlJobId: string;
    rootUrl: string;
    portfolioUrl?: string;
    config?: CrawlConfig;
  }): Promise<DiscoveryResult> {
    const { tenantId, entityId, crawlJobId, rootUrl, portfolioUrl, config } = params;
    const maxPages = Math.min(config?.maxPages ?? 25, 100);
    const maxDepth = Math.min(config?.maxDepth ?? 3, 5);
    const allowedOrigins = config?.allowedOrigins || [];
    const respectRobots = config?.respectRobotsTxt ?? true;

    logger.info(`[CrawlCoordinator] Starting discovery for crawl ${crawlJobId} (Root: ${rootUrl}, MaxPages: ${maxPages}, MaxDepth: ${maxDepth})`);

    // 1. Update crawl job and ingestion job status to 'discovering' / 'PROCESSING'
    await this.db.updateCrawlJob(tenantId, crawlJobId, { status: 'discovering' });
    await this.db.updateJobStatus(tenantId, crawlJobId, 'PROCESSING');

    // 2. Fetch robots.txt
    let robots: RobotsInfo = { sitemaps: [], disallowedPaths: [], allowedPaths: [] };
    if (respectRobots) {
      try {
        robots = await this.robotsParser.fetchAndParse(rootUrl);
        logger.info(`[CrawlCoordinator] Robots.txt for ${rootUrl}: ${robots.sitemaps.length} sitemap(s), ${robots.disallowedPaths.length} disallow rule(s)`);
      } catch (err: any) {
        logger.warn(`[CrawlCoordinator] Error fetching robots.txt: ${err.message}`);
      }
    }

    const discoveredMap = new Map<string, { url: string; depth: number; source: 'root' | 'sitemap' | 'link' }>();

    // Add root URL itself (depth 0)
    const normalizedRoot = normalizeUrl(rootUrl);
    if (normalizedRoot) {
      discoveredMap.set(normalizedRoot, { url: normalizedRoot, depth: 0, source: 'root' });
    }

    // 3. Discover URLs from Sitemaps
    try {
      const sitemapUrls = await this.sitemapParser.discoverUrls(rootUrl, robots.sitemaps, maxPages);
      for (const smUrl of sitemapUrls) {
        if (discoveredMap.size >= maxPages) break;
        if (!discoveredMap.has(smUrl)) {
          if (!respectRobots || this.robotsParser.isPathAllowed(new URL(smUrl).pathname, robots)) {
            discoveredMap.set(smUrl, { url: smUrl, depth: 1, source: 'sitemap' });
          }
        }
      }
      logger.info(`[CrawlCoordinator] Sitemap discovery yielded ${sitemapUrls.length} URL(s)`);
    } catch (smErr: any) {
      logger.warn(`[CrawlCoordinator] Sitemap discovery encountered error: ${smErr.message}`);
    }

    // 4. Discover Internal Links via Static HTML (Breadth-First Search up to maxDepth)
    const queueToCrawl: Array<{ url: string; depth: number }> = [];
    if (normalizedRoot) {
      queueToCrawl.push({ url: normalizedRoot, depth: 0 });
    }

    // Also seed queue with first few sitemap URLs for link expansion if needed
    for (const item of discoveredMap.values()) {
      if (item.source === 'sitemap' && queueToCrawl.length < 5) {
        queueToCrawl.push({ url: item.url, depth: 1 });
      }
    }

    const visitedHtmlUrls = new Set<string>();

    while (queueToCrawl.length > 0 && discoveredMap.size < maxPages) {
      const current = queueToCrawl.shift()!;
      if (visitedHtmlUrls.has(current.url)) continue;
      visitedHtmlUrls.add(current.url);

      if (current.depth >= maxDepth) continue;

      try {
        const links = await this.extractLinksFromPage(current.url);
        for (const rawLink of links) {
          if (discoveredMap.size >= maxPages) break;

          const norm = normalizeUrl(rawLink, current.url);
          if (!norm) continue;

          // Boundary checks
          if (!isAllowedOrigin(norm, rootUrl, allowedOrigins)) continue;
          if (isExcludedUrl(norm).isExcluded) continue;
          if (respectRobots && !this.robotsParser.isPathAllowed(new URL(norm).pathname, robots)) continue;

          if (!discoveredMap.has(norm)) {
            const nextDepth = current.depth + 1;
            discoveredMap.set(norm, { url: norm, depth: nextDepth, source: 'link' });
            if (nextDepth < maxDepth) {
              queueToCrawl.push({ url: norm, depth: nextDepth });
            }
          }
        }
      } catch (pageErr: any) {
        logger.debug(`[CrawlCoordinator] Could not extract links from ${current.url}: ${pageErr.message}`);
      }
    }

    let pagesToPersist = Array.from(discoveredMap.values()).slice(0, maxPages);
    if (config?.selectedUrls && config.selectedUrls.length > 0) {
      const selectedSet = new Set(config.selectedUrls.map(u => normalizeUrl(u)).filter(Boolean));
      pagesToPersist = pagesToPersist.filter(p => selectedSet.has(p.url) || selectedSet.has(normalizeUrl(p.url)));
    }
    logger.info(`[CrawlCoordinator] Total distinct pages discovered: ${pagesToPersist.length}`);

    // 5. Persist crawl_pages and create documents & ingestion_job_documents
    const createdPages: CrawlPage[] = [];
    let folderPrefix = portfolioUrl;
    if (!folderPrefix) {
      const entity = await this.db.getEntityById(tenantId, entityId);
      folderPrefix = entity?.portfolioUrl || entity?.slug || `${tenantId}/${entityId}`;
    }

    const existingPages = await this.db.getCrawlPages(tenantId, crawlJobId);
    const existingPageMap = new Map<string, CrawlPage>();
    for (const ep of existingPages) {
      existingPageMap.set(ep.normalizedUrl, ep);
      existingPageMap.set(ep.originalUrl, ep);
      existingPageMap.set(ep.normalizedUrl.replace(/\/+$/, ''), ep);
    }

    let newlyDiscoveredCount = 0;

    for (const item of pagesToPersist) {
      const existingPage = existingPageMap.get(item.url) || existingPageMap.get(item.url.replace(/\/+$/, ''));
      let resolvedDocId: string;

      if (existingPage && existingPage.documentId) {
        resolvedDocId = existingPage.documentId;
        // Existing page: reset to queued, isUnchanged to false
        await this.db.updateCrawlPage(tenantId, crawlJobId, existingPage.id, {
          status: 'queued',
          stage: 'QUEUED_FOR_DOWNLOAD',
          isUnchanged: false,
        });
        await this.db.updateJobDocumentStage(tenantId, crawlJobId, resolvedDocId, 'QUEUED_FOR_DOWNLOAD');
        await this.db.updateJobDocumentStatus(tenantId, crawlJobId, resolvedDocId, 'PENDING');
      } else {
        newlyDiscoveredCount++;
        const documentId = generateUuid();
        const initialContentHash = computeSha256(`webpage:${entityId}:${item.url}`);

        let filename = 'webpage.md';
        try {
          const u = new URL(item.url);
          const hostSlug = u.hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
          const pathSlug = u.pathname.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9.-]/g, '_') || 'home';
          filename = `${hostSlug}_${pathSlug}.md`;
        } catch {
          // fallback
        }
        const initialObjectKey = buildS3ObjectKey(folderPrefix, filename);

        // Create document entry (or retrieve existing on conflict)
        const createdDoc = await this.db.createDocument({
          id: documentId,
          tenantId,
          entityId,
          originalFilename: filename,
          mimeType: 'text/markdown',
          sizeBytes: 0,
          contentHash: initialContentHash,
          objectKey: initialObjectKey,
          isPublic: true,
          status: 'PENDING',
          sourceType: 'WEBSITE_CRAWL',
        });
        resolvedDocId = createdDoc.id;

        // Create ingestion job document entry
        await this.db.createJobDocument(tenantId, crawlJobId, resolvedDocId, {
          sourceUrl: item.url,
          stage: 'QUEUED_FOR_DOWNLOAD',
          downloadMetadata: { sourceType: 'webpage', crawlJobId, depth: item.depth, source: item.source },
        });

        // Create crawl page entry
        const [cp] = await this.db.createCrawlPages([{
          tenantId,
          entityId,
          crawlJobId,
          documentId: resolvedDocId,
          originalUrl: item.url,
          normalizedUrl: item.url,
          depth: item.depth,
        }]);

        if (cp) {
          createdPages.push(cp);
        }
      }

      // Enqueue page job onto URL download queue
      await this.queue.enqueueUrlDownloadJob({
        tenantId,
        entityId,
        jobId: crawlJobId,
        documentId: resolvedDocId,
        url: item.url,
        portfolioUrl,
        sourceType: 'website',
        crawlJobId,
        depth: item.depth,
        action: 'WEBSITE_PAGE',
        attempt: 1,
      });
    }

    // 6. Update crawl job and ingestion job status to 'processing_pages' / 'PROCESSING'
    const crawlJob = await this.db.getCrawlJob(tenantId, entityId, crawlJobId);
    await this.db.updateCrawlJob(tenantId, crawlJobId, {
      status: pagesToPersist.length > 0 ? 'processing_pages' : 'completed',
      discoveredCount: Math.max(pagesToPersist.length, crawlJob?.discoveredCount || 0),
      queuedCount: pagesToPersist.length,
      newlyDiscoveredCount: (crawlJob?.newlyDiscoveredCount || 0) + newlyDiscoveredCount,
    });

    await this.db.updateJobStatus(tenantId, crawlJobId, pagesToPersist.length > 0 ? 'PROCESSING' : 'READY', {
      processed: 0,
      failed: 0,
    });

    if (this.db.syncCrawlJobAggregates) {
      await this.db.syncCrawlJobAggregates(tenantId, crawlJobId);
    }

    return {
      crawlJobId,
      rootUrl,
      discoveredCount: pagesToPersist.length,
      queuedCount: pagesToPersist.length,
      pages: pagesToPersist,
    };
  }

  /**
   * Fetches page HTML securely with SSRF check and extracts all <a href> link targets.
   */
  private async extractLinksFromPage(pageUrl: string): Promise<string[]> {
    const validated = await validateUrlForSsrf(pageUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    let res: Response;
    try {
      res = await fetch(validated.validatedUrl.toString(), {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'PersonaRAG-Crawler/1.0 (+https://personarag.ai)',
          'Accept': 'text/html,application/xhtml+xml',
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) return [];
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('text/html') && !contentType.toLowerCase().includes('application/xhtml+xml')) {
      return [];
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const rawLinks: string[] = [];

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && !href.startsWith('#') && !href.startsWith('javascript:') && !href.startsWith('mailto:')) {
        rawLinks.push(href.trim());
      }
    });

    return rawLinks;
  }

  /**
   * Discovers eligible website routes without modifying database records or queueing extraction tasks.
   * Used for Phase 3 selective route extraction preview.
   */
  async discoverRoutesOnly(params: {
    rootUrl: string;
    config?: CrawlConfig;
  }): Promise<{
    rootUrl: string;
    discoveredCount: number;
    pages: Array<{ url: string; path: string; depth: number; source: 'root' | 'sitemap' | 'link' }>;
  }> {
    const { rootUrl, config } = params;
    const maxPages = Math.min(config?.maxPages ?? 30, 100);
    const maxDepth = Math.min(config?.maxDepth ?? 3, 5);
    const allowedOrigins = config?.allowedOrigins || [];
    const respectRobots = config?.respectRobotsTxt ?? true;

    const normalizedRoot = normalizeUrl(rootUrl);
    if (!normalizedRoot) {
      throw new Error(`Invalid root URL: ${rootUrl}`);
    }

    let robots: RobotsInfo = { sitemaps: [], disallowedPaths: [], allowedPaths: [] };
    if (respectRobots) {
      try {
        robots = await this.robotsParser.fetchAndParse(normalizedRoot);
      } catch (err: any) {
        logger.warn(`[CrawlCoordinator] Error fetching robots.txt: ${err.message}`);
      }
    }

    const discoveredMap = new Map<string, { url: string; depth: number; source: 'root' | 'sitemap' | 'link' }>();
    discoveredMap.set(normalizedRoot, { url: normalizedRoot, depth: 0, source: 'root' });

    try {
      const sitemapUrls = await this.sitemapParser.discoverUrls(normalizedRoot, robots.sitemaps, maxPages);
      for (const smUrl of sitemapUrls) {
        if (discoveredMap.size >= maxPages) break;
        if (!discoveredMap.has(smUrl)) {
          if (!respectRobots || this.robotsParser.isPathAllowed(new URL(smUrl).pathname, robots)) {
            discoveredMap.set(smUrl, { url: smUrl, depth: 1, source: 'sitemap' });
          }
        }
      }
    } catch (smErr: any) {
      logger.warn(`[CrawlCoordinator] Sitemap discovery encountered error: ${smErr.message}`);
    }

    const queueToCrawl: Array<{ url: string; depth: number }> = [{ url: normalizedRoot, depth: 0 }];
    for (const item of discoveredMap.values()) {
      if (item.source === 'sitemap' && queueToCrawl.length < 5) {
        queueToCrawl.push({ url: item.url, depth: 1 });
      }
    }

    const visitedHtmlUrls = new Set<string>();
    while (queueToCrawl.length > 0 && discoveredMap.size < maxPages) {
      const current = queueToCrawl.shift()!;
      if (visitedHtmlUrls.has(current.url)) continue;
      visitedHtmlUrls.add(current.url);

      if (current.depth >= maxDepth) continue;

      try {
        const links = await this.extractLinksFromPage(current.url);
        for (const rawLink of links) {
          if (discoveredMap.size >= maxPages) break;

          const norm = normalizeUrl(rawLink, current.url);
          if (!norm) continue;

          if (!isAllowedOrigin(norm, normalizedRoot, allowedOrigins)) continue;
          if (isExcludedUrl(norm).isExcluded) continue;
          if (respectRobots && !this.robotsParser.isPathAllowed(new URL(norm).pathname, robots)) continue;

          if (!discoveredMap.has(norm)) {
            const nextDepth = current.depth + 1;
            discoveredMap.set(norm, { url: norm, depth: nextDepth, source: 'link' });
            if (nextDepth < maxDepth) {
              queueToCrawl.push({ url: norm, depth: nextDepth });
            }
          }
        }
      } catch (pageErr: any) {
        logger.debug(`[CrawlCoordinator] Could not extract links from ${current.url}: ${pageErr.message}`);
      }
    }

    const pages = Array.from(discoveredMap.values()).map(p => {
      let path = '/';
      try {
        const u = new URL(p.url);
        path = u.pathname + (u.search || '');
      } catch {}
      return {
        url: p.url,
        path,
        depth: p.depth,
        source: p.source,
      };
    });

    return {
      rootUrl: normalizedRoot,
      discoveredCount: pages.length,
      pages,
    };
  }
}
