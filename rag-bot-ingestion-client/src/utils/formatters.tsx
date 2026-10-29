import React from 'react';

/**
 * Strips raw internal document chunk tags like [DOC-uuid], comma-separated [DOC-a, DOC-b],
 * or truncated dangling tags like [DOC-uuid from the answer prose so users only read clean, natural text.
 */
export function cleanDocCitationTags(text: string): string {
  if (!text) return '';
  return text
    // 1. Remove bracketed or parenthesized groups containing DOC- or CHUNK
    .replace(/\[[^\]]*\bDOC-[^\]]*\]/gi, '')
    .replace(/\([^)]*\bDOC-[^)]*\)/gi, '')
    .replace(/\[[^\]]*\bCHUNK\b[^\]]*\]/gi, '')
    // 2. Remove unclosed / truncated citations at the end of text (e.g. '[DOC-123, DOC-456' cut off by token limit)
    .replace(/\[\s*DOC-[^\]]*$/gi, '')
    .replace(/\(\s*DOC-[^)]*$/gi, '')
    .replace(/\[\s*CHUNK[^\]]*$/gi, '')
    // 3. Remove any lingering bare DOC-uuid or CHUNK-uuid tags
    .replace(/\bDOC-[a-zA-Z0-9_-]+/gi, '')
    .replace(/\bCHUNK-[a-zA-Z0-9_-]+/gi, '')
    // 4. Remove empty or trailing brackets
    .replace(/\[\s*\]/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\[\s*$/g, '')
    .replace(/\(\s*$/g, '')
    .replace(/[ \t]+([.,!?;:])/g, '$1')
    .replace(/[^\S\r\n]{2,}/g, ' ')
    // Ensure every bullet point starts on its own brand-new line
    .replace(/([^\n])\s*([•*]|\s-\s)\s*/g, '$1\n• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Renders text with markdown bolding (**text**) and bullet point styling
 * so that answers look visually polished, literate, and bullet points always start on a new line.
 */
export function formatAnswerParagraph(text: string): React.ReactNode {
  // Ensure every bullet point starts on its own brand-new line
  const normalizedText = text
    .replace(/([^\n])\s*([•*]|\s-\s)\s*/g, '$1\n• ')
    .replace(/\r\n/g, '\n');

  const lines = normalizedText.split('\n').map(l => l.trim()).filter(Boolean);
  return (
    <>
      {lines.map((line, lIdx) => {
        const isBullet = /^([•\-*]|\d+\.)\s*/.test(line);
        const cleanLine = line.replace(/^([•\-*]|\d+\.)\s*/, '');

        // Parse **bold** fragments
        const parts = cleanLine.split(/(\*\*[^*]+\*\*)/g);
        const formattedLine = parts.map((part, pIdx) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={pIdx}>{part.slice(2, -2)}</strong>;
          }
          return part;
        });

        if (isBullet) {
          return (
            <div key={lIdx} className="qa-bullet-item">
              <span className="qa-bullet-dot">•</span>
              <span className="qa-bullet-content">{formattedLine}</span>
            </div>
          );
        }

        return (
          <div key={lIdx} className="qa-text-line">
            {formattedLine}
          </div>
        );
      })}
    </>
  );
}

export function capitalizeName(str: string): string {
  if (!str) return 'User';
  return str
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Cleanly truncate long filenames and query parameters, preserving extension.
 */
export function formatDisplayName(filename: string, maxLen = 28): string {
  if (!filename) return 'Document';
  // Strip URL query parameters or hashes
  let clean = filename.split('?')[0].split('#')[0];
  // Strip path segments
  clean = clean.split('/').pop()?.split('\\').pop() || clean;
  if (clean.length <= maxLen) return clean;

  const extIndex = clean.lastIndexOf('.');
  if (extIndex > 0 && extIndex > clean.length - 8) {
    const ext = clean.substring(extIndex);
    const base = clean.substring(0, extIndex);
    const keepStart = maxLen - ext.length - 4;
    return `${base.substring(0, Math.max(keepStart, 6))}...${base.substring(base.length - 4)}${ext}`;
  }
  return `${clean.substring(0, maxLen - 3)}...`;
}

/**
 * Formats byte size into human readable string (KB, MB, GB).
 */
export function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null || isNaN(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

