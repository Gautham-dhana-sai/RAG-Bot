import { URL } from 'url';

/**
 * Standard list of tracking and analytical query parameters that should be stripped
 * to ensure deterministic URL deduplication without altering content identification.
 */
const TRACKING_QUERY_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'wbraid',
  'gbraid',
  'msclkid',
  'yclid',
  '_ga',
  '_gl',
  'mc_eid',
  'mc_cid',
  'ref',
  'ref_src',
  'source',
]);

/**
 * Common non-content, binary, and media extensions that cannot contain extractable HTML.
 */
const EXCLUDED_EXTENSIONS = new RegExp(
  '\\.(pdf|zip|tar|gz|tgz|rar|7z|bz2|' +
  'png|jpg|jpeg|gif|svg|webp|ico|bmp|tiff|' +
  'mp4|webm|ogv|avi|mov|wmv|mp3|wav|ogg|m4a|aac|' +
  'exe|dmg|pkg|deb|rpm|apk|msi|' +
  'css|js|map|json|xml|rss|atom|woff|woff2|ttf|eot|otf)$',
  'i'
);

/**
 * Sensitive or non-readable path patterns (auth, session, checkout, search traps).
 */
const EXCLUDED_PATH_PATTERNS: RegExp[] = [
  /\/login(?:\/|$)/i,
  /\/logout(?:\/|$)/i,
  /\/signin(?:\/|$)/i,
  /\/signout(?:\/|$)/i,
  /\/signup(?:\/|$)/i,
  /\/register(?:\/|$)/i,
  /\/auth(?:\/|$)/i,
  /\/reset-password(?:\/|$)/i,
  /\/forgot-password(?:\/|$)/i,
  /\/cart(?:\/|$)/i,
  /\/checkout(?:\/|$)/i,
  /\/account(?:\/|$)/i,
  /\/api\//i,
  /\/webhook(?:\/|$)/i,
  /\/search(?:\/|$|\?)/i,
];

/**
 * Normalizes a URL string against an optional base URL:
 * - Resolves relative paths
 * - Removes fragments (#...)
 * - Normalizes protocol and hostname casing
 * - Removes default ports (80 for http, 443 for https)
 * - Strips embedded user credentials
 * - Strips known analytics/tracking query parameters
 * - Preserves content-identifying query parameters in sorted order
 * - Normalizes trailing slashes consistently
 */
export function normalizeUrl(rawUrl: string, baseUrl?: string): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = baseUrl ? new URL(trimmed, baseUrl) : new URL(trimmed);
  } catch {
    return null;
  }

  // Only HTTP and HTTPS
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  // Reject credentials
  parsed.username = '';
  parsed.password = '';

  // Lowercase protocol and host
  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();

  // Strip default ports
  if ((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')) {
    parsed.port = '';
  }

  // Strip hash fragment
  parsed.hash = '';

  // Filter and sort query parameters
  const params = Array.from(parsed.searchParams.entries())
    .filter(([key]) => !TRACKING_QUERY_PARAMS.has(key.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));

  parsed.search = '';
  for (const [key, val] of params) {
    parsed.searchParams.append(key, val);
  }

  // Normalize path trailing slash (preserve single root '/')
  let pathname = parsed.pathname || '/';
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }
  parsed.pathname = pathname;

  return parsed.toString();
}

/**
 * Checks whether a candidate URL belongs to the same origin as the root URL
 * or matches any explicitly permitted additional origins.
 */
export function isAllowedOrigin(candidateUrl: string, rootUrl: string, approvedOrigins: string[] = []): boolean {
  try {
    const candidateParsed = new URL(candidateUrl);
    const rootParsed = new URL(rootUrl);

    // Exact match of protocol + host + port
    if (candidateParsed.origin === rootParsed.origin) {
      return true;
    }

    // Check approved additional origins
    for (const approved of approvedOrigins) {
      try {
        const approvedParsed = new URL(approved);
        if (candidateParsed.origin === approvedParsed.origin) {
          return true;
        }
      } catch {
        // ignore
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Evaluates whether a URL should be excluded from crawling:
 * - Binary and media file extensions
 * - Auth, session, admin, checkout, and form endpoints
 * - Infinite search query traps
 */
export function isExcludedUrl(url: string, customExclusions: string[] = []): { isExcluded: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { isExcluded: true, reason: 'Invalid URL format' };
  }

  const pathname = parsed.pathname;

  // 1. Check binary & media extensions
  if (EXCLUDED_EXTENSIONS.test(pathname)) {
    return { isExcluded: true, reason: 'Unsupported binary/media extension' };
  }

  // 2. Check path patterns
  for (const pattern of EXCLUDED_PATH_PATTERNS) {
    if (pattern.test(pathname)) {
      return { isExcluded: true, reason: `Excluded non-content path pattern: ${pattern}` };
    }
  }

  // 3. Search trap check
  if (parsed.searchParams.has('q') || parsed.searchParams.has('search') || parsed.searchParams.has('query')) {
    return { isExcluded: true, reason: 'Search query trap' };
  }

  // 4. Custom exclusions
  for (const custom of customExclusions) {
    try {
      const reg = new RegExp(custom, 'i');
      if (reg.test(url)) {
        return { isExcluded: true, reason: `Matched custom exclusion: ${custom}` };
      }
    } catch {
      // ignore invalid regex
    }
  }

  return { isExcluded: false };
}

