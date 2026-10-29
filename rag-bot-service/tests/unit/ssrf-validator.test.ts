import { describe, it, expect } from 'vitest';
import { isBlockedIp, validateUrlForSsrf, redactUrlForLogging, SsrfValidationError } from '../../src/shared/ssrf-validator.js';

describe('SSRF Protection & IP Validation (Criteria 6, 7)', () => {
  it('should block IPv4 loopback and private ranges', () => {
    expect(isBlockedIp('127.0.0.1')).toBe(true);
    expect(isBlockedIp('127.0.0.2')).toBe(true);
    expect(isBlockedIp('10.0.0.1')).toBe(true);
    expect(isBlockedIp('10.255.255.255')).toBe(true);
    expect(isBlockedIp('172.16.0.1')).toBe(true);
    expect(isBlockedIp('172.31.255.255')).toBe(true);
    expect(isBlockedIp('192.168.1.1')).toBe(true);
    expect(isBlockedIp('0.0.0.0')).toBe(true);
  });

  it('should block AWS & cloud instance metadata endpoints', () => {
    expect(isBlockedIp('169.254.169.254')).toBe(true);
    expect(isBlockedIp('169.254.1.1')).toBe(true); // Link-local
    expect(isBlockedIp('fd00:ec2::254')).toBe(true); // AWS IPv6 metadata
  });

  it('should block IPv6 loopback, local and link-local ranges', () => {
    expect(isBlockedIp('::1')).toBe(true);
    expect(isBlockedIp('::')).toBe(true);
    expect(isBlockedIp('fe80::1')).toBe(true);
    expect(isBlockedIp('fc00::1')).toBe(true);
  });

  it('should allow public routable IP addresses', () => {
    expect(isBlockedIp('8.8.8.8')).toBe(false);
    expect(isBlockedIp('1.1.1.1')).toBe(false);
    expect(isBlockedIp('93.184.216.34')).toBe(false); // example.com
  });

  it('should reject non-HTTP/HTTPS schemes (Criteria 4)', async () => {
    await expect(validateUrlForSsrf('ftp://example.com/file.pdf')).rejects.toThrow(
      'Only HTTP and HTTPS are permitted'
    );
    await expect(validateUrlForSsrf('file:///etc/passwd')).rejects.toThrow(
      'Only HTTP and HTTPS are permitted'
    );
    await expect(validateUrlForSsrf('gopher://example.com/')).rejects.toThrow(
      'Only HTTP and HTTPS are permitted'
    );
  });

  it('should reject URLs containing embedded credentials (Criteria 4)', async () => {
    await expect(validateUrlForSsrf('https://admin:password@example.com/doc.pdf')).rejects.toThrow(
      'URLs containing user credentials are not permitted'
    );
  });

  it('should block direct localhost hostnames', async () => {
    await expect(validateUrlForSsrf('http://localhost:3000/api')).rejects.toThrow(
      'Access to internal or local hostname "localhost" is blocked'
    );
    await expect(validateUrlForSsrf('http://app.internal/doc.pdf')).rejects.toThrow(
      'is blocked'
    );
  });

  it('should safely redact query parameters in URLs for logging', () => {
    const raw = 'https://s3.amazonaws.com/bucket/doc.pdf?AWSAccessKeyId=AKIA12345&Signature=secret123';
    const redacted = redactUrlForLogging(raw);
    expect(redacted).toBe('https://s3.amazonaws.com/bucket/doc.pdf?REDACTED');
    expect(redacted).not.toContain('AKIA12345');
    expect(redacted).not.toContain('secret123');
  });
});

