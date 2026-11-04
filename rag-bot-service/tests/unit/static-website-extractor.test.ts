import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StaticWebsiteExtractor, WebsiteExtractionError } from '../../src/modules/downloader/static-website-extractor.js';

describe('StaticWebsiteExtractor Unit Tests', () => {
  let extractor: StaticWebsiteExtractor;

  beforeEach(() => {
    extractor = new StaticWebsiteExtractor({ timeoutMs: 5000, maxRedirects: 3 });
  });

  it('should extract title, headings, paragraphs, lists, and tables from valid static HTML', () => {
    const sampleHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <title>Engineering Architecture &amp; Cloud Systems | Acme Corp</title>
        <meta name="description" content="Overview of Acme distributed systems and microservices." />
        <link rel="canonical" href="https://acme.org/architecture" />
        <style>.hidden { display: none; }</style>
        <script>console.log("tracking");</script>
      </head>
      <body>
        <header>
          <nav>
            <a href="/">Home</a>
            <a href="/products">Products</a>
          </nav>
        </header>

        <div class="cookie-banner">
          We use cookies. Click accept.
        </div>

        <main>
          <h1>Cloud Infrastructure Platform</h1>
          <p>Acme Corp operates a multi-region Kubernetes cluster running on AWS and Bare Metal.</p>

          <h2>Core Capabilities</h2>
          <ul>
            <li>High-throughput event streaming with Apache Kafka</li>
            <li>Zero-trust service mesh with Cilium and eBPF</li>
            <li>PostgreSQL pgvector dense and sparse hybrid retrieval</li>
          </ul>

          <h2>Performance Metrics</h2>
          <table>
            <thead>
              <tr><th>Metric</th><th>P95 Latency</th><th>Throughput</th></tr>
            </thead>
            <tbody>
              <tr><td>Search API</td><td>42ms</td><td>12,000 rps</td></tr>
              <tr><td>Ingestion Pipeline</td><td>180ms</td><td>3,500 docs/s</td></tr>
            </tbody>
          </table>

          <blockquote>Built for 99.99% availability across global regions.</blockquote>
          <pre><code>kubectl get pods -n production</code></pre>
        </main>

        <footer>
          <p>&copy; 2026 Acme Corp. All rights reserved.</p>
        </footer>
      </body>
      </html>
    `;

    const result = extractor.extractFromHtml(sampleHtml, 'https://acme.org/architecture');

    expect(result.sourceType).toBe('webpage');
    expect(result.canonicalUrl).toBe('https://acme.org/architecture');
    expect(result.title).toContain('Engineering Architecture & Cloud Systems');
    expect(result.contentType).toBe('text/markdown');

    // Headings, lists, tables present
    expect(result.content).toContain('Cloud Infrastructure Platform');
    expect(result.content).toContain('Core Capabilities');
    expect(result.content).toContain('- High-throughput event streaming with Apache Kafka');
    expect(result.content).toContain('- Zero-trust service mesh with Cilium and eBPF');
    expect(result.content).toContain('| Metric | P95 Latency | Throughput |');
    expect(result.content).toContain('| Search API | 42ms | 12,000 rps |');
    expect(result.content).toContain('> Built for 99.99% availability across global regions.');
    expect(result.content).toContain('```\nkubectl get pods -n production\n```');

    // Boilerplate stripped
    expect(result.content).not.toContain('We use cookies');
    expect(result.content).not.toContain('console.log');
    expect(result.content).not.toContain('All rights reserved');

    // Content hash generated
    expect(result.contentHash).toBeDefined();
    expect(result.contentHash).toHaveLength(64);
  });

  it('should reject empty HTML or JavaScript-only SPA shells with NO_CONTENT_FOUND error', () => {
    const spaShellHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>React App</title>
      </head>
      <body>
        <div id="root"></div>
        <script src="/bundle.js"></script>
      </body>
      </html>
    `;

    expect(() => {
      extractor.extractFromHtml(spaShellHtml, 'https://spa.example.com');
    }).toThrowError(WebsiteExtractionError);

    try {
      extractor.extractFromHtml(spaShellHtml, 'https://spa.example.com');
    } catch (err: any) {
      expect(err.isNoContent).toBe(true);
      expect(err.statusCode).toBe(422);
      expect(err.message).toContain('No meaningful static content was found');
    }
  });

  it('should block SSRF requests targeting loopback, private, and AWS metadata destinations', async () => {
    await expect(extractor.extractFromUrl('http://127.0.0.1/admin')).rejects.toThrowError(/SSRF/);
    await expect(extractor.extractFromUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrowError(/SSRF/);
    await expect(extractor.extractFromUrl('http://10.0.0.1/status')).rejects.toThrowError(/SSRF/);
    await expect(extractor.extractFromUrl('http://192.168.1.1/router')).rejects.toThrowError(/SSRF/);
    await expect(extractor.extractFromUrl('http://[::1]/internal')).rejects.toThrowError(/SSRF/);
  });

  it('should reject invalid URL schemes or embedded credentials', async () => {
    await expect(extractor.extractFromUrl('ftp://example.com/file')).rejects.toThrow();
    await expect(extractor.extractFromUrl('file:///etc/passwd')).rejects.toThrow();
    await expect(extractor.extractFromUrl('https://user:pass@example.com/page')).rejects.toThrow();
  });
});

