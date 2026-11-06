import React, { memo } from 'react';

export interface CitationItem {
  quote?: string;
  snippet?: string;
  chunkId?: string;
  documentId?: string;
  versionId?: string;
  documentTitle?: string;
  sourceType?: string;
  mimeType?: string;
  sourceUrl?: string;
  pageNumber?: number;
  score?: number;
}

interface QaCitationListProps {
  citations?: CitationItem[];
  onViewDocument?: (doc: {
    documentId: string;
    documentTitle: string;
    mimeType?: string;
    pageNumber?: number;
  }) => void;
}

function getSafeCitationTitle(c: CitationItem): string {
  if (c.documentTitle) return c.documentTitle;
  if (c.sourceUrl) {
    try {
      const u = new URL(c.sourceUrl);
      return u.pathname && u.pathname !== '/' ? u.pathname : u.hostname;
    } catch {
      return c.sourceUrl;
    }
  }
  return 'Source';
}

export const QaCitationList: React.FC<QaCitationListProps> = memo(({
  citations,
  onViewDocument,
}) => {
  if (!citations || citations.length === 0) return null;

  return (
    <div className="qa-citations-box" style={{ marginTop: '0.75rem', borderTop: '1px solid #e2e8f0', paddingTop: '0.75rem' }}>
      <div className="qa-citations-title" style={{ fontSize: '0.82rem', fontWeight: 600, color: '#334155', marginBottom: '0.5rem' }}>
        📚 Grounded Sources ({citations.length}):
      </div>
      <div className="qa-citations-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {citations.map((c, cIdx) => {
          const isWebsiteSource = Boolean(
            c.sourceUrl ||
            c.sourceType === 'WEBSITE_IMPORT' ||
            c.sourceType === 'WEBSITE_CRAWL'
          );
          const hasDocId = Boolean(c.documentId);
          const title = getSafeCitationTitle(c);
          const safeWebHref = c.sourceUrl
            ? c.sourceUrl.startsWith('http://') || c.sourceUrl.startsWith('https://')
              ? c.sourceUrl
              : `https://${c.sourceUrl}`
            : undefined;

          return (
            <div
              key={c.chunkId || cIdx}
              className="qa-citation-item"
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
                padding: '0.65rem 0.85rem',
                fontSize: '0.82rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
                  <span className="qa-citation-badge" style={{ background: '#e0f2fe', color: '#0369a1', fontWeight: 600, fontSize: '0.72rem', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>
                    Ref [{cIdx + 1}]
                  </span>
                  <span
                    style={{ fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '320px' }}
                    title={title}
                  >
                    {title}
                  </span>
                  {c.pageNumber && c.pageNumber > 1 && (
                    <span style={{ fontSize: '0.72rem', color: '#64748b' }}>p. {c.pageNumber}</span>
                  )}
                </div>

                {/* Clickable Source Actions: For website sources only open website; for documents view document */}
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  {isWebsiteSource && safeWebHref ? (
                    <a
                      href={safeWebHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="qa-citation-url-link"
                      title={`Open website: ${c.sourceUrl}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        fontSize: '0.75rem',
                        color: '#0284c7',
                        textDecoration: 'none',
                        background: '#ffffff',
                        border: '1px solid #bae6fd',
                        borderRadius: '4px',
                        padding: '0.2rem 0.55rem',
                        fontWeight: 500,
                      }}
                    >
                      🌐 Open Website ↗
                    </a>
                  ) : hasDocId && onViewDocument ? (
                    <button
                      type="button"
                      className="btn-secondary btn-xs"
                      onClick={() =>
                        onViewDocument({
                          documentId: c.documentId!,
                          documentTitle: c.documentTitle || 'Document',
                          mimeType: c.mimeType,
                          pageNumber: c.pageNumber,
                        })
                      }
                      title="Open document viewer"
                      style={{
                        fontSize: '0.75rem',
                        padding: '0.2rem 0.55rem',
                        background: '#ffffff',
                        border: '1px solid #cbd5e1',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        color: '#334155',
                        fontWeight: 500,
                      }}
                    >
                      📄 View Document ↗
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Quote / Snippet */}
              {(c.quote || c.snippet) && (
                <div
                  className="qa-citation-quote"
                  style={{
                    fontStyle: 'italic',
                    color: '#475569',
                    fontSize: '0.78rem',
                    background: '#ffffff',
                    borderLeft: '3px solid #38bdf8',
                    padding: '0.35rem 0.6rem',
                    borderRadius: '0 4px 4px 0',
                    margin: '0.35rem 0',
                  }}
                >
                  &quot;{c.quote || c.snippet}&quot;
                </div>
              )}

              <div className="qa-citation-meta" style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                {c.chunkId && <span>Chunk: <code>{c.chunkId.substring(0, 8)}</code></span>}
                {c.score !== undefined && <span> &bull; Relevance: {Math.round(c.score * 100)}%</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

QaCitationList.displayName = 'QaCitationList';
