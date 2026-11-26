import * as cheerio from 'cheerio';
import { URL } from 'url';
import { validateUrlForSsrf } from '../../shared/ssrf-validator.js';
import { logger } from '../../shared/logger.js';

const MAX_SCRIPT_BUNDLES = 3;
const MAX_BUNDLE_BYTES = 2.5 * 1024 * 1024; // 2.5MB cap per JS bundle
const BUNDLE_FETCH_TIMEOUT_MS = 8000;

/**
 * Extracts same-origin <script src="..."> URLs from an HTML document.
 */
export function extractSameOriginScriptUrls(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const baseOrigin = new URL(baseUrl).origin;
  const scriptUrls: string[] = [];

  $('script[src]').each((_, el) => {
    const src = $(el).attr('src')?.trim();
    if (!src) return;
    try {
      const resolved = new URL(src, baseUrl);
      if (resolved.origin === baseOrigin && (resolved.protocol === 'http:' || resolved.protocol === 'https:')) {
        if (!scriptUrls.includes(resolved.toString())) {
          scriptUrls.push(resolved.toString());
        }
      }
    } catch {
      // ignore invalid URL
    }
  });

  return scriptUrls.slice(0, MAX_SCRIPT_BUNDLES);
}

/**
 * Securely fetches a JS bundle with SSRF validation and size/timeout bounds.
 */
async function fetchSafeScriptText(scriptUrl: string): Promise<string | null> {
  try {
    const { validatedUrl } = await validateUrlForSsrf(scriptUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BUNDLE_FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(validatedUrl.toString(), {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'OpenBot-Crawler/1.0 (+https://open-bot.ai)',
          'Accept': 'application/javascript,text/javascript,*/*',
        },
      });
      if (!res.ok) return null;

      const contentLength = res.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_BUNDLE_BYTES) {
        return null;
      }

      const text = await res.text();
      if (text.length > MAX_BUNDLE_BYTES) {
        return text.slice(0, MAX_BUNDLE_BYTES);
      }
      return text;
    } finally {
      clearTimeout(timer);
    }
  } catch (err: any) {
    logger.debug(`[SpaExtractor] Failed to fetch script bundle ${scriptUrl}: ${err?.message}`);
    return null;
  }
}

/**
 * Discovers client-side router paths (e.g. React Router / Vue Router) from same-origin JS bundles.
 */
export async function extractSpaRoutesFromHtml(html: string, baseUrl: string): Promise<string[]> {
  const scriptUrls = extractSameOriginScriptUrls(html, baseUrl);
  if (scriptUrls.length === 0) return [];

  const discoveredRoutes = new Set<string>();
  const routeRegex = /(?:path|to|href)\s*:\s*['"](\/[a-zA-Z0-9_/-]*)['"]/g;

  for (const scriptUrl of scriptUrls) {
    const js = await fetchSafeScriptText(scriptUrl);
    if (!js) continue;

    let match: RegExpExecArray | null;
    while ((match = routeRegex.exec(js)) !== null) {
      const candidate = match[1];
      if (
        candidate &&
        candidate !== '/' &&
        !candidate.startsWith('/assets') &&
        !candidate.startsWith('/static') &&
        !candidate.startsWith('/api/') &&
        !candidate.startsWith('/_next') &&
        !/\.[a-z0-9]{2,5}$/i.test(candidate)
      ) {
        discoveredRoutes.add(candidate);
      }
    }
  }

  return Array.from(discoveredRoutes);
}

/**
 * Extracts structured readable text from SPA JSON payloads (__NEXT_DATA__, JSON-LD)
 * or compiled same-origin JS bundles when static HTML is an empty SPA shell.
 */
export async function extractSpaReadableMarkdown(
  html: string,
  baseUrl: string,
  pageTitle: string,
  metaDescription: string
): Promise<{ markdown: string; routes: string[]; paragraphsCount: number; headingsCount: number } | null> {
  const blocks: string[] = [];
  if (pageTitle && pageTitle !== 'Webpage') {
    blocks.push(`# ${pageTitle}\n`);
  }
  if (metaDescription) {
    blocks.push(`> ${metaDescription}\n`);
  }

  const seenText = new Set<string>();
  let paragraphsCount = 0;
  let headingsCount = pageTitle && pageTitle !== 'Webpage' ? 1 : 0;

  const addTextLine = (raw: string, isHeading = false) => {
    const cleaned = raw
      .replace(/\\n/g, ' ')
      .replace(/\\u003[cC]/g, '<')
      .replace(/\\u003[eE]/g, '>')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleaned.length < 12) return;
    // Skip CSS class lists, SVG path data, URLs, and code/UI boilerplate
    if (
      /^(https?:\/\/|\/assets\/|M\d|rgba?\(|#[0-9a-f]{3,8}$)/i.test(cleaned) ||
      /(className|tailwind|flex-col|grid-cols|transition-|hover:|focus:|bg-|text-\[)/i.test(cleaned) ||
      /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/i.test(cleaned)
    ) {
      return;
    }

    const key = cleaned.toLowerCase();
    if (seenText.has(key)) return;
    seenText.add(key);

    if (isHeading) {
      headingsCount++;
      blocks.push(`\n## ${cleaned}\n`);
    } else {
      paragraphsCount++;
      blocks.push(`${cleaned}\n`);
    }
  };

  // 1. Check inline JSON-LD or __NEXT_DATA__ scripts in HTML
  const $ = cheerio.load(html);
  $('script[type="application/ld+json"], script#__NEXT_DATA__').each((_, el) => {
    const rawJson = $(el).text()?.trim();
    if (!rawJson) return;
    try {
      const obj = JSON.parse(rawJson);
      const walk = (node: any) => {
        if (typeof node === 'string') {
          addTextLine(node);
        } else if (Array.isArray(node)) {
          for (const item of node) walk(item);
        } else if (node && typeof node === 'object') {
          for (const val of Object.values(node)) walk(val);
        }
      };
      walk(obj);
    } catch {
      // ignore malformed JSON
    }
  });

  // 2. Fetch and extract content & routes from same-origin JS bundles
  const scriptUrls = extractSameOriginScriptUrls(html, baseUrl);
  const discoveredRoutes = new Set<string>();
  const contentRegex =
    /(?:children|title|description|summary|subtitle|role|company|institution|degree|name|bio|headline|tagline|text|label|quote|content|overview|highlights)\s*:\s*(?:"([^"\\]{12,600})"|'([^'\\]{12,600})')/g;
  const routeRegex = /(?:path|to|href)\s*:\s*['"](\/[a-zA-Z0-9_/-]*)['"]/g;

  for (const scriptUrl of scriptUrls) {
    const js = await fetchSafeScriptText(scriptUrl);
    if (!js) continue;

    let match: RegExpExecArray | null;
    while ((match = contentRegex.exec(js)) !== null) {
      const val = match[1] || match[2];
      if (val) {
        addTextLine(val, false);
      }
    }

    while ((match = routeRegex.exec(js)) !== null) {
      const r = match[1];
      if (
        r &&
        r !== '/' &&
        !r.startsWith('/assets') &&
        !r.startsWith('/static') &&
        !r.startsWith('/api/') &&
        !r.startsWith('/_next') &&
        !/\.[a-z0-9]{2,5}$/i.test(r)
      ) {
        discoveredRoutes.add(r);
      }
    }
  }

  if (paragraphsCount === 0) {
    return null;
  }

  const markdown = blocks.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const visibleLen = markdown.replace(/[#>\-\*`|\s]/g, '').length;
  if (visibleLen < 50) {
    return null;
  }

  return {
    markdown,
    routes: Array.from(discoveredRoutes),
    paragraphsCount,
    headingsCount,
  };
}
