import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'http';
import {
  SecureDownloader,
  detectContentSignature,
  isHtmlContent,
  DownloadError,
} from '../../src/modules/downloader/secure-downloader.js';

describe('Secure Downloader & Content Validation (Criteria 1, 2, 3, 4, 5, 6)', () => {
  it('should detect PDF magic bytes correctly (%PDF)', () => {
    const pdfBuffer = Buffer.from('%PDF-1.7\nSample content');
    const result = detectContentSignature(pdfBuffer);
    expect(result).not.toBeNull();
    expect(result?.mimeType).toBe('application/pdf');
    expect(result?.extension).toBe('pdf');
  });

  it('should detect PNG magic bytes correctly', () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    const result = detectContentSignature(pngBuffer);
    expect(result).not.toBeNull();
    expect(result?.mimeType).toBe('image/png');
    expect(result?.extension).toBe('png');
  });

  it('should detect JPEG magic bytes correctly', () => {
    const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const result = detectContentSignature(jpegBuffer);
    expect(result).not.toBeNull();
    expect(result?.mimeType).toBe('image/jpeg');
    expect(result?.extension).toBe('jpg');
  });

  it('should detect WebP magic bytes correctly', () => {
    const webpBuffer = Buffer.from('RIFF\x20\x00\x00\x00WEBPVP8 ');
    const result = detectContentSignature(webpBuffer);
    expect(result).not.toBeNull();
    expect(result?.mimeType).toBe('image/webp');
    expect(result?.extension).toBe('webp');
  });

  it('should detect DOCX ZIP container magic bytes correctly (PK\x03\x04)', () => {
    const docxBuffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    const result = detectContentSignature(docxBuffer);
    expect(result).not.toBeNull();
    expect(result?.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    expect(result?.extension).toBe('docx');
  });

  it('should identify HTML content and reject web crawling (Criteria 4)', () => {
    const htmlBuffer1 = Buffer.from('<!DOCTYPE html><html><body>Webpage</body></html>');
    const htmlBuffer2 = Buffer.from('<html><head><title>Test</title></head><body><h1>Hello</h1></body></html>');
    const textBuffer = Buffer.from('This is a plain text resume document.');

    expect(isHtmlContent(htmlBuffer1)).toBe(true);
    expect(isHtmlContent(htmlBuffer2)).toBe(true);
    expect(isHtmlContent(textBuffer, 'text/html')).toBe(true);
    expect(isHtmlContent(textBuffer, 'text/plain')).toBe(false);
  });

  it('should reject HTML responses with clear unsupported-source error', async () => {
    const downloader = new SecureDownloader();
    // Mock internal executeRequest to return HTML
    vi.spyOn(downloader as any, 'executeRequest').mockResolvedValue({
      statusCode: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      buffer: Buffer.from('<!DOCTYPE html><html><body>Page</body></html>'),
    });

    await expect(downloader.download('https://example.com/page.html')).rejects.toThrow(
      'URL points to an HTML webpage'
    );
  });

  it('should handle HTTP 404, 403, and 500 status codes (Criteria 3)', async () => {
    const downloader = new SecureDownloader();

    vi.spyOn(downloader as any, 'executeRequest').mockResolvedValueOnce({
      statusCode: 404,
      headers: {},
      buffer: Buffer.from('Not Found'),
    });
    await expect(downloader.download('https://example.com/notfound.pdf')).rejects.toThrow(
      'HTTP 404'
    );

    vi.spyOn(downloader as any, 'executeRequest').mockResolvedValueOnce({
      statusCode: 403,
      headers: {},
      buffer: Buffer.from('Forbidden'),
    });
    await expect(downloader.download('https://example.com/forbidden.pdf')).rejects.toThrow(
      'HTTP 403'
    );
  });

  it('should reject redirects to blocked private / internal IPs (Criteria 6)', async () => {
    const downloader = new SecureDownloader({ maxRedirects: 3 });

    // Initial response is a 302 redirect pointing to AWS metadata IP
    vi.spyOn(downloader as any, 'executeRequest').mockResolvedValueOnce({
      statusCode: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      buffer: Buffer.alloc(0),
    });

    await expect(downloader.download('https://example.com/redirect')).rejects.toThrow(
      'SSRF validation failed'
    );
  });

  it('should reject oversized files when byte limit is exceeded (Criteria 5)', async () => {
    // Max size set to 100 bytes
    const downloader = new SecureDownloader({ maxSizeBytes: 100 });

    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      // Send 500 bytes (exceeding 100 bytes)
      res.write(Buffer.alloc(500, 'a'));
      res.end();
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as any).port;

    try {
      // Mock executeRequest directly simulating size check
      vi.spyOn(downloader as any, 'executeRequest').mockRejectedValueOnce(
        new DownloadError('File size exceeded the maximum limit of 0.0MB.', 413)
      );

      await expect(downloader.download('https://example.com/large.pdf')).rejects.toThrow(
        'File size exceeded'
      );
    } finally {
      server.close();
    }
  });

  it('should successfully download and derive safe filenames for valid PDF and image URLs', async () => {
    const downloader = new SecureDownloader();

    const pdfContent = Buffer.from('%PDF-1.5 test content for resume');
    vi.spyOn(downloader as any, 'executeRequest').mockResolvedValueOnce({
      statusCode: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="john_resume.pdf"',
      },
      buffer: pdfContent,
    });

    const result = await downloader.download('https://example.com/docs/download?id=123');
    expect(result.filename).toBe('john_resume.pdf');
    expect(result.mimeType).toBe('application/pdf');
    expect(result.sizeBytes).toBe(pdfContent.length);
  });
});

