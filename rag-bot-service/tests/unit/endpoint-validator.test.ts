import { describe, it, expect } from 'vitest';
import {
  validateFileOrPhotoUrl,
  verifyLiveEndpoint,
  SUPPORTED_FILE_EXTENSIONS,
  REJECTED_WEB_EXTENSIONS,
} from '../../src/shared/endpoint-validator.js';

describe('Endpoint & File URL Validator', () => {
  describe('validateFileOrPhotoUrl', () => {
    it('should accept valid direct file URLs', () => {
      const pdfRes = validateFileOrPhotoUrl('https://example.com/docs/resume.pdf');
      expect(pdfRes.isValid).toBe(true);

      const docxRes = validateFileOrPhotoUrl('https://example.com/docs/project.docx');
      expect(docxRes.isValid).toBe(true);

      const txtRes = validateFileOrPhotoUrl('https://example.com/notes.txt');
      expect(txtRes.isValid).toBe(true);

      const mdRes = validateFileOrPhotoUrl('https://example.com/readme.md');
      expect(mdRes.isValid).toBe(true);
    });

    it('should accept valid photo and image URLs', () => {
      const pngRes = validateFileOrPhotoUrl('https://example.com/assets/avatar.png');
      expect(pngRes.isValid).toBe(true);

      const jpgRes = validateFileOrPhotoUrl('https://example.com/photos/profile.jpg');
      expect(jpgRes.isValid).toBe(true);

      const webpRes = validateFileOrPhotoUrl('https://example.com/banner.webp');
      expect(webpRes.isValid).toBe(true);

      const unsplashRes = validateFileOrPhotoUrl('https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=800');
      expect(unsplashRes.isValid).toBe(true);
    });

    it('should reject HTML and web page endpoints', () => {
      const htmlRes = validateFileOrPhotoUrl('https://example.com/index.html');
      expect(htmlRes.isValid).toBe(false);
      expect(htmlRes.reason).toContain('HTML webpages (.html) are not supported');

      const htmRes = validateFileOrPhotoUrl('https://example.com/about.htm');
      expect(htmRes.isValid).toBe(false);

      const phpRes = validateFileOrPhotoUrl('https://example.com/contact.php');
      expect(phpRes.isValid).toBe(false);

      const jspRes = validateFileOrPhotoUrl('https://example.com/app/dashboard.jsp');
      expect(jspRes.isValid).toBe(false);

      const aspRes = validateFileOrPhotoUrl('https://example.com/default.asp');
      expect(aspRes.isValid).toBe(false);
    });

    it('should reject generic endpoints and domain roots without file/photo extensions', () => {
      const rootRes = validateFileOrPhotoUrl('https://example.com/');
      expect(rootRes.isValid).toBe(false);
      expect(rootRes.reason).toContain('URL does not point to a supported file or photo');

      const endpointRes = validateFileOrPhotoUrl('https://example.com/api/v1/users');
      expect(endpointRes.isValid).toBe(false);

      const nonHttpRes = validateFileOrPhotoUrl('ftp://example.com/file.pdf');
      expect(nonHttpRes.isValid).toBe(false);
      expect(nonHttpRes.reason).toContain('Unsupported protocol');
    });
  });

  describe('verifyLiveEndpoint', () => {
    it('should block SSRF and loopback / private IP addresses', async () => {
      const loopbackRes = await verifyLiveEndpoint('http://127.0.0.1/status');
      expect(loopbackRes.isLive).toBe(false);
      expect(loopbackRes.reason).toMatch(/restricted|blocked|private/i);

      const metadataRes = await verifyLiveEndpoint('http://169.254.169.254/latest/meta-data/');
      expect(metadataRes.isLive).toBe(false);
      expect(metadataRes.reason).toMatch(/restricted|blocked|private/i);
    });

    it('should recognize test domain URLs during test environment', async () => {
      const testRes = await verifyLiveEndpoint('https://sarahconnor.engineering/portfolio');
      expect(testRes.isLive).toBe(true);
      expect(testRes.successfulUrl).toBe('https://sarahconnor.engineering/portfolio');
    });
  });
});

