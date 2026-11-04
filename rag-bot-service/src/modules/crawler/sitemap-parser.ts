import { URL } from 'url';
import { validateUrlForSsrf } from '../../shared/ssrf-validator.js';
import { normalizeUrl, isAllowedOrigin, isExcludedUrl } from './url-normalizer.js';
import { logger } from '../../shared/logger.js';

export class SitemapParser {
  private timeoutMs: number;
  private maxSizeBytes: number;
  private maxChildSitemaps: number;

  constructor(options?: { timeoutMs?: number; maxSizeBytes?: number; maxChildSitemaps?: number }) {
    this.timeoutMs = options?.timeoutMs ?? 10000;
    this.maxSizeBytes = options?.maxSizeBytes ?? 5 * 1024 * 1024; // 5MB
    this.maxChildSitemaps = options?.maxChildSitemaps ?? 5;
  }

  /**
   * Discovers URLs from public sitemaps for a website root.
   */
  async discoverUrls(
    rootUrl: string,
    additionalSitemapUrls: string[] = [],
    maxUrls = 100
  ): Promise<string[]> {
    const discoveredUrls = new Set<string>();
    const rootOrigin = new URL(rootUrl).origin;

    // Collect sitemap candidates to check
    const candidates = new Set<string>();
    for (const sm of additionalSitemapUrls) {
      candidates.add(sm);
    }
    candidates.add(`${rootOrigin}/sitemap.xml`);
    candidates.add(`${rootOrigin}/sitemap_index.xml`);

    for (const sitemapUrl of candidates) {
      if (discoveredUrls.size >= maxUrls) break;
      try {
        await this.fetchAndParseSitemap(sitemapUrl, rootUrl, discoveredUrls, maxUrls, 0);
      } catch (err: any) {
        logger.debug(`[SitemapParser] Sitemap ${sitemapUrl} could not be parsed: ${err.message}`);
      }
    }

    return Array.from(discoveredUrls);
  }

  private async fetchAndParseSitemap(
    sitemapUrl: string,
    rootUrl: string,
    discoveredUrls: Set<string>,
    maxUrls: number,
    depth: number
  ): Promise<void> {
    if (depth > 2 || discoveredUrls.size >= maxUrls) return;

    // 1. SSRF and Same-Origin validation
    if (!isAllowedOrigin(sitemapUrl, rootUrl)) {
      logger.debug(`[SitemapParser] Skipping cross-origin sitemap: ${sitemapUrl}`);
      return;
    }

    const validated = await validateUrlForSsrf(sitemapUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(validated.validatedUrl.toString(), {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'PersonaRAG-Crawler/1.0 (+https://personarag.ai)',
          'Accept': 'application/xml, text/xml, */*',
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      return;
    }

    const text = await res.text();
    if (text.length > this.maxSizeBytes) {
      logger.warn(`[SitemapParser] Sitemap ${sitemapUrl} exceeded maximum size (${this.maxSizeBytes} bytes). Skipping.`);
      return;
    }

    // 2. Check if Sitemap Index
    if (text.includes('<sitemapindex') || text.includes('<sitemap>')) {
      const childSitemaps = this.extractLocTags(text);
      const toFetch = childSitemaps.slice(0, this.maxChildSitemaps);
      for (const childUrl of toFetch) {
        if (discoveredUrls.size >= maxUrls) break;
        try {
          await this.fetchAndParseSitemap(childUrl, rootUrl, discoveredUrls, maxUrls, depth + 1);
        } catch {
          // ignore individual child failures
        }
      }
      return;
    }

    // 3. Regular <urlset>
    const urls = this.extractLocTags(text);
    for (const rawUrl of urls) {
      if (discoveredUrls.size >= maxUrls) break;
      const normalized = normalizeUrl(rawUrl, rootUrl);
      if (!normalized) continue;

      if (!isAllowedOrigin(normalized, rootUrl)) continue;
      if (isExcludedUrl(normalized).isExcluded) continue;

      discoveredUrls.add(normalized);
    }
  }

  /**
   * Parse URLs from a raw XML sitemap string.
   */
  public parseUrlsFromXml(xml: string, rootUrl: string): string[] {
    const urls = this.extractLocTags(xml);
    const discovered: string[] = [];
    for (const rawUrl of urls) {
      const normalized = normalizeUrl(rawUrl, rootUrl);
      if (!normalized) continue;
      if (!isAllowedOrigin(normalized, rootUrl)) continue;
      if (isExcludedUrl(normalized).isExcluded) continue;
      if (!discovered.includes(normalized)) {
        discovered.push(normalized);
      }
    }
    return discovered;
  }

  /**
   * Fast regex-based <loc> extraction from XML string.
   */
  public extractLocTags(xml: string): string[] {
    const results: string[] = [];
    const locRegex = /<loc>(?:<!\[CDATA\[)?(https?:\/\/[^\]<>]+)(?:\]\]>)?<\/loc>/gi;
    let match: RegExpExecArray | null;

    while ((match = locRegex.exec(xml)) !== null) {
      const url = match[1]?.trim();
      if (url && !results.includes(url)) {
        results.push(url);
      }
    }
    return results;
  }
}
