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
    // 4. Remove empty brackets
    .replace(/\[\s*\]/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\[\s*$/g, '')
    .replace(/\(\s*$/g, '')
    .replace(/[ \t]+([.,!?;:])/g, '$1')
    .replace(/[^\S\r\n]{2,}/g, ' ')
    .trim();
}

/**
 * Formats inline Markdown elements: **bold**, *italic*, `code`.
 */
export function formatInlineMarkdown(text: string): React.ReactNode {
  if (!text) return null;

  // Split tokens for `code`, **bold**, and *italic*
  const tokenRegex = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|(?<!\*)\*[^*]+\*(?!\*)|(?<!_)_[^_]+_(?!_))/g;
  const parts = text.split(tokenRegex);

  return parts.map((part, idx) => {
    if (!part) return null;
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <code key={idx} className="qa-inline-code">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (
      (part.startsWith('**') && part.endsWith('**') && part.length >= 4) ||
      (part.startsWith('__') && part.endsWith('__') && part.length >= 4)
    ) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    if (
      (part.startsWith('*') && part.endsWith('*') && part.length >= 2) ||
      (part.startsWith('_') && part.endsWith('_') && part.length >= 2)
    ) {
      return <em key={idx}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

/**
 * Formats Markdown answer text cleanly into friendly, readable elements:
 * - Headings (#, ##, ###)
 * - Clean bullet lists (-, *, •) without empty bullets
 * - Numbered lists (1., 2.)
 * - Horizontal rules (---, ***, --)
 * - Formatted paragraphs with bold, italic, and code highlighting
 */
export function formatAnswerText(text: string): React.ReactNode {
  if (!text) return null;

  const rawLines = text.replace(/\r\n/g, '\n').split('\n');
  const elements: React.ReactNode[] = [];
  let currentListItems: React.ReactNode[] = [];

  const flushList = () => {
    if (currentListItems.length > 0) {
      elements.push(
        <div key={`list-${elements.length}`} className="qa-bullet-list">
          {currentListItems}
        </div>
      );
      currentListItems = [];
    }
  };

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    const trimmed = rawLine.trim();

    // 1. Skip completely empty lines or stray lone symbols
    if (!trimmed || trimmed === '*' || trimmed === '•' || trimmed === '-' || trimmed === '+') {
      flushList();
      continue;
    }

    // 2. Horizontal divider: ---, ***, ___, --
    if (/^(\-{2,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushList();
      elements.push(<hr key={`divider-${elements.length}`} className="qa-divider" />);
      continue;
    }

    // 3. Headings: #, ##, ###
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      const content = headingMatch[2].trim();
      const HeadingTag = (level === 1 ? 'h3' : level === 2 ? 'h4' : 'h5') as keyof JSX.IntrinsicElements;
      const className = `qa-heading qa-heading-${level}`;
      elements.push(
        <HeadingTag key={`heading-${elements.length}`} className={className}>
          {formatInlineMarkdown(content)}
        </HeadingTag>
      );
      continue;
    }

    // 4. Bullet list items: - Item, * Item, • Item, + Item, 1. Item
    const bulletMatch = trimmed.match(/^([•\-\*+]|\d+\.)\s+(.*)$/);
    if (bulletMatch) {
      const marker = bulletMatch[1];
      const content = bulletMatch[2].trim();
      // If content is empty or just lone asterisks, skip it
      if (!content || content === '*' || content === '•') {
        continue;
      }

      const isNumbered = /^\d+\.$/.test(marker);
      currentListItems.push(
        <div key={`bullet-${i}`} className="qa-bullet-item">
          <span className="qa-bullet-dot">{isNumbered ? marker : '•'}</span>
          <div className="qa-bullet-content">{formatInlineMarkdown(content)}</div>
        </div>
      );
      continue;
    }

    // 5. Normal text paragraph
    flushList();
    elements.push(
      <p key={`p-${elements.length}`} className="qa-text-paragraph">
        {formatInlineMarkdown(trimmed)}
      </p>
    );
  }

  flushList();
  return <>{elements}</>;
}

export function formatAnswerParagraph(text: string): React.ReactNode {
  return formatAnswerText(text);
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

