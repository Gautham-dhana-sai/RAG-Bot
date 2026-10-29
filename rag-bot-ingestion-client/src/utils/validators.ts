/**
 * Supported file and photo extensions for URL ingestion.
 */
export const SUPPORTED_FILE_EXTENSIONS = new Set([
  // Documents
  'pdf', 'docx', 'doc', 'txt', 'rtf', 'md', 'json', 'csv',
  // Photos / Images
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'tiff',
]);

export const REJECTED_WEB_EXTENSIONS = new Set([
  'html', 'htm', 'php', 'jsp', 'asp', 'aspx', 'do', 'action', 'cgi',
]);

/**
 * Validates that an imported URL points to a supported file or photo,
 * explicitly rejecting HTML webpages and non-file endpoints.
 */
export function validateFileOrPhotoUrlClient(rawUrl: string): { isValid: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (err: any) {
    return { isValid: false, reason: `Invalid URL format: "${rawUrl}". Please enter a valid HTTP or HTTPS URL.` };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { isValid: false, reason: `Unsupported protocol "${parsed.protocol}". Only HTTP and HTTPS are allowed.` };
  }

  const pathname = parsed.pathname.toLowerCase();

  // Reject HTML / web extensions
  for (const ext of REJECTED_WEB_EXTENSIONS) {
    if (pathname.endsWith(`.${ext}`)) {
      return {
        isValid: false,
        reason: `HTML webpages (.${ext}) cannot be imported. Please provide direct links to files (.pdf, .docx, .txt) or photos (.png, .jpg, .webp).`,
      };
    }
  }

  // Check for supported file / photo extension in pathname
  const dotIndex = pathname.lastIndexOf('.');
  if (dotIndex !== -1 && dotIndex < pathname.length - 1) {
    const ext = pathname.substring(dotIndex + 1).split('/')[0];
    if (SUPPORTED_FILE_EXTENSIONS.has(ext)) {
      return { isValid: true };
    }
  }

  // Image hosting service pattern check (e.g. Unsplash, Cloudinary, Imgur, S3)
  const isImageHosting =
    pathname.includes('/photo-') ||
    pathname.includes('/image/') ||
    pathname.includes('/images/') ||
    pathname.includes('/photos/') ||
    parsed.hostname.includes('unsplash.com') ||
    parsed.hostname.includes('cloudinary.com') ||
    parsed.hostname.includes('imgur.com');

  const formatParam = (parsed.searchParams.get('format') || parsed.searchParams.get('fm') || '').toLowerCase();
  if (isImageHosting || (formatParam && SUPPORTED_FILE_EXTENSIONS.has(formatParam))) {
    return { isValid: true };
  }

  if (pathname === '/' || pathname === '' || dotIndex === -1) {
    return {
      isValid: false,
      reason: `URL "${rawUrl}" does not point to a supported file or photo. Please provide a direct link to a PDF, DOCX, TXT, PNG, JPG, or WebP file (e.g. https://example.com/document.pdf). Webpage crawling is not supported.`,
    };
  }

  return {
    isValid: false,
    reason: `Unsupported file extension in URL "${rawUrl}". Supported formats are PDF, DOCX, TXT, PNG, JPEG, and WebP.`,
  };
}

