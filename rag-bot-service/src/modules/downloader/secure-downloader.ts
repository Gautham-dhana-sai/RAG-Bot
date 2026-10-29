import http from 'http';
import https from 'https';
import { URL } from 'url';
import { validateUrlForSsrf, redactUrlForLogging, SsrfValidationError } from '../../shared/ssrf-validator.js';
import { env } from '../../config/env.js';
import { logger } from '../../shared/logger.js';

export interface DownloadResult {
  buffer: Buffer;
  mimeType: string;
  filename: string;
  sizeBytes: number;
  finalUrl: string;
}

export class DownloadError extends Error {
  constructor(message: string, public statusCode?: number, public isSsrf = false) {
    super(message);
    this.name = 'DownloadError';
  }
}

/**
 * Inspect magic bytes of a buffer to detect actual content type.
 */
export function detectContentSignature(buffer: Buffer): { mimeType: string; extension: string } | null {
  if (buffer.length < 4) return null;

  // PDF: %PDF-
  if (buffer.subarray(0, 4).toString('ascii') === '%PDF') {
    return { mimeType: 'application/pdf', extension: 'pdf' };
  }

  // PNG: \x89PNG\r\n\x1a\n
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mimeType: 'image/png', extension: 'png' };
  }

  // JPEG: \xFF\xD8\xFF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }

  // WebP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mimeType: 'image/webp', extension: 'webp' };
  }

  // DOCX / ZIP container: PK\x03\x04
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    return {
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extension: 'docx',
    };
  }

  return null;
}

/**
 * Checks whether content is an HTML webpage rather than a document or image.
 */
export function isHtmlContent(buffer: Buffer, declaredMimeType?: string): boolean {
  if (declaredMimeType && declaredMimeType.toLowerCase().includes('text/html')) {
    return true;
  }

  const sample = buffer.subarray(0, 1024).toString('utf-8').trim().toLowerCase();
  if (
    sample.startsWith('<!doctype html') ||
    sample.startsWith('<html') ||
    sample.includes('<head>') ||
    sample.includes('<body')
  ) {
    return true;
  }

  return false;
}

export class SecureDownloader {
  private maxSizeBytes: number;
  private timeoutMs: number;
  private maxRedirects: number;

  constructor(options?: { maxSizeBytes?: number; timeoutMs?: number; maxRedirects?: number }) {
    this.maxSizeBytes = options?.maxSizeBytes ?? env.MAX_FILE_SIZE_BYTES;
    this.timeoutMs = options?.timeoutMs ?? env.DOWNLOAD_TIMEOUT_MS;
    this.maxRedirects = options?.maxRedirects ?? env.DOWNLOAD_MAX_REDIRECTS;
  }

  /**
   * Securely download a file from a URL with SSRF protection, size streaming limits,
   * redirect validation, and magic byte signature verification.
   */
  async download(initialUrl: string): Promise<DownloadResult> {
    let currentUrl = initialUrl;
    let redirectsCount = 0;

    while (redirectsCount <= this.maxRedirects) {
      const redacted = redactUrlForLogging(currentUrl);
      logger.info(`[SecureDownloader] Validating destination: ${redacted} (redirect: ${redirectsCount})`);

      // 1. SSRF destination validation
      let validatedUrl: URL;
      try {
        const validation = await validateUrlForSsrf(currentUrl);
        validatedUrl = validation.validatedUrl;
      } catch (err: any) {
        if (err instanceof SsrfValidationError) {
          throw new DownloadError(`SSRF validation failed: ${err.message}`, 403, true);
        }
        throw err;
      }

      // 2. Perform HTTP request to the validated URL
      const response = await this.executeRequest(validatedUrl);

      // Handle Redirects (301, 302, 303, 307, 308)
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        redirectsCount++;
        if (redirectsCount > this.maxRedirects) {
          throw new DownloadError(
            `Exceeded maximum allowed redirects (${this.maxRedirects}). Download aborted.`,
            response.statusCode
          );
        }

        const nextUrl = new URL(response.headers.location, validatedUrl).toString();
        logger.info(`[SecureDownloader] Following redirect (${redirectsCount}/${this.maxRedirects}) to: ${redactUrlForLogging(nextUrl)}`);
        currentUrl = nextUrl;
        continue;
      }

      // Reject non-200 responses
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        throw new DownloadError(
          `Remote server returned HTTP ${response.statusCode} for URL: ${redactUrlForLogging(currentUrl)}`,
          response.statusCode
        );
      }

      // 3. Reject HTML webpages directly
      const declaredContentType = response.headers['content-type'] || '';
      if (isHtmlContent(response.buffer, declaredContentType)) {
        throw new DownloadError(
          'URL points to an HTML webpage rather than a supported document or image. Webpage crawling is not supported.',
          400
        );
      }

      // 4. Verify Content Signature
      const signature = detectContentSignature(response.buffer);
      let resolvedMimeType = signature ? signature.mimeType : declaredContentType.split(';')[0].trim().toLowerCase();

      // If text/plain, verify it's readable text without binary garbage
      if (!signature) {
        const isLikelyText = /^text\/|json|xml|csv/i.test(declaredContentType) || this.isTextBuffer(response.buffer);
        if (isLikelyText) {
          resolvedMimeType = 'text/plain';
        } else {
          throw new DownloadError(
            `Unsupported file format with content-type "${declaredContentType}". Supported formats are PDF, PNG, JPEG, WebP, DOCX, and TXT.`,
            415
          );
        }
      }

      // 5. Derive safe filename
      const filename = this.deriveSafeFilename(validatedUrl, response.headers, signature?.extension);

      return {
        buffer: response.buffer,
        mimeType: resolvedMimeType,
        filename,
        sizeBytes: response.buffer.length,
        finalUrl: currentUrl,
      };
    }

    throw new DownloadError(`Download failed after ${redirectsCount} redirects.`);
  }

  private isTextBuffer(buf: Buffer): boolean {
    // Check first 512 bytes for null bytes or control characters
    const len = Math.min(buf.length, 512);
    for (let i = 0; i < len; i++) {
      if (buf[i] === 0) return false;
    }
    return true;
  }

  private deriveSafeFilename(url: URL, headers: http.IncomingHttpHeaders, detectedExt?: string): string {
    // Try Content-Disposition header
    const disposition = headers['content-disposition'];
    if (disposition) {
      const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)["']?/i);
      if (match && match[1]) {
        const clean = decodeURIComponent(match[1]).trim().replace(/[^a-zA-Z0-9._-]/g, '_');
        if (clean.length > 0) return clean;
      }
    }

    // Try path from URL
    const pathname = url.pathname;
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length > 0) {
      const last = decodeURIComponent(segments[segments.length - 1]).trim().replace(/[^a-zA-Z0-9._-]/g, '_');
      if (last.includes('.') && last.length > 0) {
        return last;
      }
      if (last.length > 0 && detectedExt) {
        return `${last}.${detectedExt}`;
      }
    }

    // Fallback timestamped filename
    const ext = detectedExt || 'bin';
    return `downloaded_${Date.now()}.${ext}`;
  }

  private executeRequest(targetUrl: URL): Promise<{
    statusCode: number;
    headers: http.IncomingHttpHeaders;
    buffer: Buffer;
  }> {
    return new Promise((resolve, reject) => {
      const isHttps = targetUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const reqOptions: http.RequestOptions = {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        path: `${targetUrl.pathname}${targetUrl.search}`,
        method: 'GET',
        headers: {
          'User-Agent': 'PersonaRAG-Downloader/1.0 (+https://personarag.ai)',
          Accept: 'application/pdf,image/*,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,*/*',
          Connection: 'close',
        },
        timeout: this.timeoutMs,
      };

      const req = client.request(reqOptions, res => {
        const chunks: Buffer[] = [];
        let totalReceived = 0;

        res.on('data', (chunk: Buffer) => {
          totalReceived += chunk.length;
          if (totalReceived > this.maxSizeBytes) {
            req.destroy(
              new DownloadError(
                `File size exceeded the maximum limit of ${(this.maxSizeBytes / 1024 / 1024).toFixed(1)}MB.`,
                413
              )
            );
            return;
          }
          chunks.push(chunk);
        });

        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 200,
            headers: res.headers,
            buffer: Buffer.concat(chunks),
          });
        });

        res.on('error', err => reject(err));
      });

      req.on('timeout', () => {
        req.destroy(new DownloadError(`Connection timed out after ${this.timeoutMs}ms.`, 504));
      });

      req.on('error', err => {
        if (err instanceof DownloadError) {
          reject(err);
        } else {
          reject(new DownloadError(`Network error during download: ${err.message}`, 502));
        }
      });

      req.end();
    });
  }
}

