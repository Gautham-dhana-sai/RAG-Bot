import { URL } from 'url';
import { validateUrlForSsrf } from '../../shared/ssrf-validator.js';
import { logger } from '../../shared/logger.js';

export interface RobotsInfo {
  sitemaps: string[];
  crawlDelayMs?: number;
  disallowedPaths: string[];
  allowedPaths: string[];
}

export class RobotsParser {
  private timeoutMs: number;

  constructor(timeoutMs = 6000) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * Fetches and parses robots.txt for a given origin URL.
   * Fails open (allows crawling) if robots.txt does not exist or returns an error.
   */
  async fetchAndParse(rootUrl: string): Promise<RobotsInfo> {
    const sitemaps: string[] = [];
    const disallowedPaths: string[] = [];
    const allowedPaths: string[] = [];
    let crawlDelayMs: number | undefined;

    let robotsUrl: string;
    try {
      const parsed = new URL(rootUrl);
      robotsUrl = `${parsed.origin}/robots.txt`;
    } catch {
      return { sitemaps, disallowedPaths, allowedPaths };
    }

    try {
      const validated = await validateUrlForSsrf(robotsUrl);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      const res = await fetch(validated.validatedUrl.toString(), {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'PersonaRAG-Crawler/1.0 (+https://personarag.ai)',
        },
      });
      clearTimeout(timeout);

      if (!res.ok) {
        return { sitemaps, disallowedPaths, allowedPaths };
      }

      const text = await res.text();
      return this.parseRobotsTxt(text, rootUrl);
    } catch (err: any) {
      logger.debug(`[RobotsParser] Could not fetch robots.txt for ${rootUrl}: ${err.message}`);
      return { sitemaps, disallowedPaths, allowedPaths };
    }
  }

  /**
   * Parses raw robots.txt text.
   */
  parseRobotsTxt(content: string, baseUrl: string): RobotsInfo {
    const sitemaps: string[] = [];
    const disallowedPaths: string[] = [];
    const allowedPaths: string[] = [];
    let crawlDelayMs: number | undefined;

    const lines = content.split(/\r?\n/);
    let appliesToUs = false;

    for (let line of lines) {
      // Remove comments
      const hashIdx = line.indexOf('#');
      if (hashIdx >= 0) {
        line = line.substring(0, hashIdx);
      }
      line = line.trim();
      if (!line) continue;

      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;

      const field = line.substring(0, colonIdx).trim().toLowerCase();
      const value = line.substring(colonIdx + 1).trim();

      if (field === 'sitemap') {
        try {
          const sitemapUrl = new URL(value, baseUrl).toString();
          if (!sitemaps.includes(sitemapUrl)) {
            sitemaps.push(sitemapUrl);
          }
        } catch {
          // ignore invalid sitemap URL
        }
        continue;
      }

      if (field === 'user-agent') {
        const ua = value.toLowerCase();
        // We match * or personarag-crawler
        if (ua === '*' || ua.includes('personarag')) {
          appliesToUs = true;
        } else {
          appliesToUs = false;
        }
        continue;
      }

      if (!appliesToUs) continue;

      if (field === 'disallow') {
        if (value) {
          disallowedPaths.push(value);
        }
      } else if (field === 'allow') {
        if (value) {
          allowedPaths.push(value);
        }
      } else if (field === 'crawl-delay') {
        const seconds = parseFloat(value);
        if (!isNaN(seconds) && seconds > 0) {
          crawlDelayMs = Math.min(seconds * 1000, 30000); // capped at 30s
        }
      }
    }

    return {
      sitemaps,
      disallowedPaths,
      allowedPaths,
      crawlDelayMs,
    };
  }

  /**
   * Tests whether a path is allowed under the parsed robots.txt rules.
   */
  isPathAllowed(path: string, robots: RobotsInfo): boolean {
    const cleanPath = path || '/';

    // Explicit allow rules take precedence
    for (const allow of robots.allowedPaths) {
      if (cleanPath.startsWith(allow)) {
        return true;
      }
    }

    // Check disallow rules
    for (const disallow of robots.disallowedPaths) {
      if (disallow === '/') {
        return false;
      }
      if (cleanPath.startsWith(disallow)) {
        return false;
      }
    }

    return true;
  }
}

