import crypto from 'crypto';

export interface HashedPassword {
  hash: string;
  salt: string;
}

export function hashPassword(password: string): HashedPassword {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  try {
    const derived = crypto.scryptSync(password, salt, 64).toString('hex');
    const hashBuf = Buffer.from(hash, 'hex');
    const derivedBuf = Buffer.from(derived, 'hex');
    if (hashBuf.length !== derivedBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(hashBuf, derivedBuf);
  } catch {
    return false;
  }
}

export function normalizePortfolioUrl(rawUrl: string): string {
  let trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error('Portfolio URL cannot be empty');
  }

  // Prepend https:// if protocol is missing
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }

  const parsed = new URL(trimmed);
  // Lowercase protocol and host
  const protocol = parsed.protocol.toLowerCase();
  const host = parsed.host.toLowerCase();
  
  // Clean path: remove trailing slash unless it's just root '/'
  let pathname = parsed.pathname;
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.replace(/\/+$/, '');
  }

  // Construct normalized URL without hash fragment
  const search = parsed.search; // keep query params if any
  return `${protocol}//${host}${pathname}${search}`;
}

