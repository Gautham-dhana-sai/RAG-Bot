import { URL } from 'url';
import * as cheerio from 'cheerio';
import { validateUrlForSsrf, redactUrlForLogging, SsrfValidationError } from '../../shared/ssrf-validator.js';
import { computeSha256 } from '../../shared/utils.js';
import { logger } from '../../shared/logger.js';
import { env } from '../../config/env.js';

export interface WebsiteExtractionResult {
  sourceType: 'webpage';
  sourceUrl: string;
  canonicalUrl: string;
  title: string;
  contentType: 'text/markdown';
  content: string;
  contentHash: string;
  extractedAt: string;
  links: string[];
  metadata: {
    description?: string;
    headingsCount: number;
    paragraphsCount: number;
    textLength: number;
    isClientSideShell?: boolean;
  };
}

export class WebsiteExtractionError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
    public isSsrf = false,
    public isNoContent = false
  ) {
    super(message);
    this.name = 'WebsiteExtractionError';
  }
}

export class StaticWebsiteExtractor {
  private maxSizeBytes: number;
  private timeoutMs: number;
  private maxRedirects: number;

  constructor(options?: { maxSizeBytes?: number; timeoutMs?: number; maxRedirects?: number }) {
    this.maxSizeBytes = options?.maxSizeBytes ?? Math.min(env.MAX_FILE_SIZE_BYTES, 5 * 1024 * 1024); // 5MB cap for HTML
    this.timeoutMs = options?.timeoutMs ?? Math.min(env.DOWNLOAD_TIMEOUT_MS, 20000); // 20s
    this.maxRedirects = options?.maxRedirects ?? env.DOWNLOAD_MAX_REDIRECTS;
  }

  /**
   * Fetches public static HTML, validates SSRF and Content-Type,
   * strips boilerplate, and normalizes into structured Markdown.
   */
  async extractFromUrl(targetUrl: string): Promise<WebsiteExtractionResult> {
    const safeLogUrl = redactUrlForLogging(targetUrl);
    logger.info(`[StaticWebsiteExtractor] Starting extraction for URL: ${safeLogUrl}`);

    // 1. Fetch raw HTML with strict security controls
    const { html, finalUrl } = await this.fetchHtml(targetUrl);

    // 2. Extract and parse static content
    return this.extractFromHtml(html, finalUrl, targetUrl);
  }

  /**
   * Parses raw HTML string and produces clean structured Markdown.
   */
  extractFromHtml(html: string, finalUrl: string, originalUrl = finalUrl): WebsiteExtractionResult {
    if (!html || !html.trim()) {
      throw new WebsiteExtractionError(
        'The webpage returned an empty response. No static content was available.',
        422,
        false,
        true
      );
    }

    const $ = cheerio.load(html);

    // 0. Extract discovered internal/outbound hyperlinks from HTML before boilerplate removal
    const extractedLinks: string[] = [];
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (
        href &&
        !href.startsWith('#') &&
        !href.startsWith('javascript:') &&
        !href.startsWith('mailto:') &&
        !href.startsWith('tel:')
      ) {
        extractedLinks.push(href.trim());
      }
    });

    // 1. Remove non-content elements and boilerplate
    $(
      'script, style, noscript, svg, canvas, iframe, form, nav, footer, header, ' +
      'aside, [aria-hidden="true"], .cookie-banner, #cookie-banner, .cookie-notice, ' +
      '#cookie-notice, .advertisement, .ad, .social-share, .popup, .modal'
    ).remove();

    // 2. Extract metadata
    const pageTitle = (
      $('meta[property="og:title"]').attr('content') ||
      $('title').first().text() ||
      $('h1').first().text() ||
      'Webpage'
    )
      .replace(/\s+/g, ' ')
      .trim();

    const canonicalHref = $('link[rel="canonical"]').attr('href');
    let canonicalUrl = finalUrl;
    if (canonicalHref) {
      try {
        canonicalUrl = new URL(canonicalHref, finalUrl).toString();
      } catch {
        canonicalUrl = finalUrl;
      }
    }

    const metaDescription = (
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      ''
    ).trim();

    // 3. Select primary content container
    let $root = $('main, article, [role="main"]').first();
    if ($root.length === 0 || $root.text().trim().length < 60) {
      $root = $('#content, #main, .content, .main-content, .post-content').first();
    }
    if ($root.length === 0 || $root.text().trim().length < 60) {
      $root = $('body');
    }

    // 4. Build Markdown representation
    const markdownBlocks: string[] = [];
    let headingsCount = 0;
    let paragraphsCount = 0;

    // Add main page title if found
    if (pageTitle && pageTitle !== 'Webpage') {
      markdownBlocks.push(`# ${pageTitle}\n`);
    }

    if (metaDescription) {
      markdownBlocks.push(`> ${metaDescription}\n`);
    }

    // Traverse structural content elements
    $root.find('h1, h2, h3, h4, h5, h6, p, ul, ol, table, blockquote, pre').each((_, el) => {
      const tagName = el.tagName?.toLowerCase();
      const $el = $(el);

      // Check if element is nested inside a table or list already handled
      if ($el.parents('ul, ol, table').length > 0) {
        return;
      }

      if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
        const text = $el.text().replace(/\s+/g, ' ').trim();
        if (text) {
          headingsCount++;
          const level = Math.min(parseInt(tagName.charAt(1), 10) + 1, 6);
          const prefix = '#'.repeat(level);
          markdownBlocks.push(`\n${prefix} ${text}\n`);
        }
        return;
      }

      if (tagName === 'p') {
        const text = $el.text().replace(/\s+/g, ' ').trim();
        if (text) {
          paragraphsCount++;
          markdownBlocks.push(`${text}\n`);
        }
        return;
      }

      if (tagName === 'ul' || tagName === 'ol') {
        const items: string[] = [];
        $el.children('li').each((liIdx, li) => {
          const liText = $(li).text().replace(/\s+/g, ' ').trim();
          if (liText) {
            const bullet = tagName === 'ol' ? `${liIdx + 1}.` : '-';
            items.push(`${bullet} ${liText}`);
          }
        });
        if (items.length > 0) {
          markdownBlocks.push(items.join('\n') + '\n');
        }
        return;
      }

      if (tagName === 'table') {
        const rows: string[][] = [];
        $el.find('tr').each((_, tr) => {
          const cells: string[] = [];
          $(tr).find('th, td').each((_, cell) => {
            cells.push($(cell).text().replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim());
          });
          if (cells.some(c => c.length > 0)) {
            rows.push(cells);
          }
        });

        if (rows.length > 0) {
          const maxCols = Math.max(...rows.map(r => r.length));
          const header = rows[0].concat(Array(Math.max(0, maxCols - rows[0].length)).fill(''));
          markdownBlocks.push(`| ${header.join(' | ')} |`);
          markdownBlocks.push(`| ${Array(maxCols).fill('---').join(' | ')} |`);
          for (let r = 1; r < rows.length; r++) {
            const row = rows[r].concat(Array(Math.max(0, maxCols - rows[r].length)).fill(''));
            markdownBlocks.push(`| ${row.join(' | ')} |`);
          }
          markdownBlocks.push('');
        }
        return;
      }

      if (tagName === 'blockquote') {
        const text = $el.text().replace(/\s+/g, ' ').trim();
        if (text) {
          markdownBlocks.push(`> ${text}\n`);
        }
        return;
      }

      if (tagName === 'pre') {
        const code = $el.text().trim();
        if (code) {
          markdownBlocks.push(`\`\`\`\n${code}\n\`\`\`\n`);
        }
        return;
      }
    });

    const normalizedContent = markdownBlocks.join('\n').replace(/\n{3,}/g, '\n\n').trim();

    // 5. Detect empty content or JavaScript-only client-rendered single page applications
    const visibleTextLength = normalizedContent.replace(/[#>\-\*`|\s]/g, '').length;
    const isClientSideShell = visibleTextLength < 50;

    if (isClientSideShell) {
      throw new WebsiteExtractionError(
        'No meaningful static content was found in the returned HTML. ' +
        'This website appears to be a client-side JavaScript Single Page Application (SPA) ' +
        'requiring a browser session to render its text.',
        422,
        false,
        true
      );
    }

    const contentHash = computeSha256(Buffer.from(normalizedContent, 'utf-8'));

    return {
      sourceType: 'webpage',
      sourceUrl: originalUrl,
      canonicalUrl,
      title: pageTitle || 'Webpage',
      contentType: 'text/markdown',
      content: normalizedContent,
      contentHash,
      extractedAt: new Date().toISOString(),
      links: extractedLinks,
      metadata: {
        description: metaDescription || undefined,
        headingsCount,
        paragraphsCount,
        textLength: normalizedContent.length,
        isClientSideShell: false,
      },
    };
  }

  /**
   * Fetches public HTML securely, verifying SSRF, redirects, response sizes, and timeouts.
   */
  private async fetchHtml(initialUrl: string): Promise<{ html: string; finalUrl: string }> {
    let currentUrl = initialUrl;
    let redirectsCount = 0;

    while (redirectsCount <= this.maxRedirects) {
      // 1. SSRF check on target destination
      let validatedUrl: URL;
      try {
        const validation = await validateUrlForSsrf(currentUrl);
        validatedUrl = validation.validatedUrl;
      } catch (err: any) {
        if (err instanceof SsrfValidationError) {
          throw new WebsiteExtractionError(`SSRF validation blocked request: ${err.message}`, 403, true);
        }
        throw new WebsiteExtractionError(`Invalid URL destination: ${err.message}`, 400);
      }

      // 2. Fetch using native fetch with strict timeout and redirect manual inspection
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);

      let response: Response;
      try {
        response = await fetch(validatedUrl.toString(), {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PersonaRAG-Crawler/1.0 (+https://personarag.ai)',
            'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });
      } catch (fetchErr: any) {
        clearTimeout(timeoutHandle);
        if (fetchErr.name === 'AbortError') {
          throw new WebsiteExtractionError(
            `Webpage request timed out after ${this.timeoutMs / 1000} seconds.`,
            504
          );
        }
        throw new WebsiteExtractionError(`Failed to connect to website: ${fetchErr.message}`, 502);
      } finally {
        clearTimeout(timeoutHandle);
      }

      // Handle Redirects (301, 302, 303, 307, 308)
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new WebsiteExtractionError('Redirect received without Location header.', response.status);
        }
        redirectsCount++;
        if (redirectsCount > this.maxRedirects) {
          throw new WebsiteExtractionError(
            `Exceeded maximum allowed redirects (${this.maxRedirects}). Aborted.`,
            response.status
          );
        }

        const nextUrl = new URL(location, validatedUrl).toString();
        logger.info(`[StaticWebsiteExtractor] Following redirect (${redirectsCount}/${this.maxRedirects}) to: ${redactUrlForLogging(nextUrl)}`);
        currentUrl = nextUrl;
        continue;
      }

      // Reject non-200 responses
      if (!response.ok) {
        throw new WebsiteExtractionError(
          `Remote website returned HTTP ${response.status} (${response.statusText}).`,
          response.status
        );
      }

      // Validate Content-Type
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.toLowerCase().includes('text/html') && !contentType.toLowerCase().includes('application/xhtml+xml')) {
        throw new WebsiteExtractionError(
          `Expected HTML content, but the website returned Content-Type "${contentType}".`,
          415
        );
      }

      // Read response body with streaming size limit
      const reader = response.body?.getReader();
      if (!reader) {
        const text = await response.text();
        if (text.length > this.maxSizeBytes) {
          throw new WebsiteExtractionError(`Webpage HTML exceeded maximum allowed size of ${this.maxSizeBytes / (1024 * 1024)} MB.`, 413);
        }
        return { html: text, finalUrl: currentUrl };
      }

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.length;
          if (totalBytes > this.maxSizeBytes) {
            reader.cancel();
            throw new WebsiteExtractionError(
              `Webpage HTML exceeded maximum allowed size of ${this.maxSizeBytes / (1024 * 1024)} MB.`,
              413
            );
          }
          chunks.push(value);
        }
      }

      const combinedBuffer = Buffer.concat(chunks);
      const html = combinedBuffer.toString('utf-8');
      return { html, finalUrl: currentUrl };
    }

    throw new WebsiteExtractionError(`Extraction aborted after ${redirectsCount} redirects.`);
  }
}

