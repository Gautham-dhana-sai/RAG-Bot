import { describe, it, expect } from 'vitest';
import {
  normalizeUrl,
  isAllowedOrigin,
  isExcludedUrl,
} from '../../src/modules/crawler/url-normalizer.js';
import { RobotsParser } from '../../src/modules/crawler/robots-parser.js';
import { SitemapParser } from '../../src/modules/crawler/sitemap-parser.js';

describe('Website Crawler Unit Tests', () => {
  describe('url-normalizer', () => {
    const base = 'https://example.com/docs/intro';

    it('should resolve relative URLs against a base URL', () => {
      expect(normalizeUrl('../guides/quickstart', base)).toBe('https://example.com/guides/quickstart');
      expect(normalizeUrl('/api/v1', base)).toBe('https://example.com/api/v1');
      expect(normalizeUrl('setup.html', base)).toBe('https://example.com/docs/setup.html');
    });

    it('should strip URL fragments', () => {
      expect(normalizeUrl('https://example.com/page#heading-2')).toBe('https://example.com/page');
      expect(normalizeUrl('https://example.com/#top')).toBe('https://example.com/');
    });

    it('should remove tracking and analytics query parameters while preserving and sorting functional parameters', () => {
      const url = 'https://example.com/articles?utm_source=twitter&b=2&utm_medium=social&a=1&fbclid=123xyz';
      const normalized = normalizeUrl(url);
      expect(normalized).toBe('https://example.com/articles?a=1&b=2');
    });

    it('should strip default ports (80 for http, 443 for https)', () => {
      expect(normalizeUrl('http://example.com:80/home')).toBe('http://example.com/home');
      expect(normalizeUrl('https://example.com:443/home')).toBe('https://example.com/home');
      expect(normalizeUrl('https://example.com:8443/home')).toBe('https://example.com:8443/home');
    });

    it('should normalize trailing slashes on subpaths but preserve root slash', () => {
      expect(normalizeUrl('https://example.com/about/')).toBe('https://example.com/about');
      expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
      expect(normalizeUrl('https://example.com')).toBe('https://example.com/');
    });

    it('should correctly test allowed origins', () => {
      const root = 'https://docs.acme.org/';
      expect(isAllowedOrigin('https://docs.acme.org/intro', root)).toBe(true);
      expect(isAllowedOrigin('https://docs.acme.org:443/api', root)).toBe(true);
      expect(isAllowedOrigin('https://api.acme.org/docs', root)).toBe(false);
      expect(isAllowedOrigin('http://docs.acme.org/', root)).toBe(false);
      expect(isAllowedOrigin('https://malicious.org/', root)).toBe(false);
      expect(isAllowedOrigin('https://external.org/', root, ['https://external.org'])).toBe(true);
    });

    it('should exclude binary files, media, auth endpoints, and search traps', () => {
      expect(isExcludedUrl('https://example.com/archive.zip').isExcluded).toBe(true);
      expect(isExcludedUrl('https://example.com/manual.pdf').isExcluded).toBe(true);
      expect(isExcludedUrl('https://example.com/logo.png').isExcluded).toBe(true);
      expect(isExcludedUrl('https://example.com/login').isExcluded).toBe(true);
      expect(isExcludedUrl('https://example.com/signup').isExcluded).toBe(true);
      expect(isExcludedUrl('https://example.com/cart').isExcluded).toBe(true);
      expect(isExcludedUrl('https://example.com/checkout').isExcluded).toBe(true);
      expect(isExcludedUrl('https://example.com/search?q=test').isExcluded).toBe(true);

      // Permitted content URLs
      expect(isExcludedUrl('https://example.com/about-us').isExcluded).toBe(false);
      expect(isExcludedUrl('https://example.com/blog/2026/future-of-ai').isExcluded).toBe(false);
      expect(isExcludedUrl('https://example.com/docs/getting-started').isExcluded).toBe(false);
    });
  });

  describe('robots-parser', () => {
    it('should extract sitemaps, crawl-delay, and respect Disallow / Allow rules', () => {
      const robotsContent = `
        User-agent: Googlebot
        Disallow: /google-secret/

        User-agent: *
        Disallow: /private/
        Disallow: /admin/
        Allow: /private/public-preview
        Crawl-delay: 5
        Sitemap: https://example.com/sitemap.xml
        Sitemap: https://example.com/sitemap-articles.xml
      `;

      const parser = new RobotsParser();
      const parsed = parser.parseRobotsTxt(robotsContent, 'https://example.com/');
      expect(parsed.sitemaps).toHaveLength(2);
      expect(parsed.sitemaps).toContain('https://example.com/sitemap.xml');
      expect(parsed.sitemaps).toContain('https://example.com/sitemap-articles.xml');
      expect(parsed.crawlDelayMs).toBe(5000);

      expect(parser.isPathAllowed('/blog', parsed)).toBe(true);
      expect(parser.isPathAllowed('/private/secret', parsed)).toBe(false);
      expect(parser.isPathAllowed('/admin/dashboard', parsed)).toBe(false);
      expect(parser.isPathAllowed('/private/public-preview', parsed)).toBe(true);
    });
  });

  describe('sitemap-parser', () => {
    it('should extract URLs from a valid sitemap.xml', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url>
            <loc>https://example.com/</loc>
            <lastmod>2026-01-01</lastmod>
            <priority>1.0</priority>
          </url>
          <url>
            <loc>https://example.com/features</loc>
            <lastmod>2026-02-01</lastmod>
          </url>
          <url>
            <loc>https://example.com/pricing</loc>
          </url>
          <url>
            <loc>https://another-domain.com/hack</loc>
          </url>
        </urlset>`;

      const parser = new SitemapParser();
      const urls = parser.parseUrlsFromXml(xml, 'https://example.com/');
      expect(urls).toHaveLength(3);
      expect(urls).toContain('https://example.com/');
      expect(urls).toContain('https://example.com/features');
      expect(urls).toContain('https://example.com/pricing');
      // Foreign domain should be filtered out
      expect(urls).not.toContain('https://another-domain.com/hack');
    });

    it('should extract child sitemaps from a sitemap index file', () => {
      const indexXml = `<?xml version="1.0" encoding="UTF-8"?>
        <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <sitemap>
            <loc>https://example.com/sitemap-main.xml</loc>
          </sitemap>
          <sitemap>
            <loc>https://example.com/sitemap-blog.xml</loc>
          </sitemap>
        </sitemapindex>`;

      const parser = new SitemapParser();
      const childSitemaps = parser.extractLocTags(indexXml);
      expect(childSitemaps).toHaveLength(2);
      expect(childSitemaps).toContain('https://example.com/sitemap-main.xml');
      expect(childSitemaps).toContain('https://example.com/sitemap-blog.xml');
    });
  });
});

