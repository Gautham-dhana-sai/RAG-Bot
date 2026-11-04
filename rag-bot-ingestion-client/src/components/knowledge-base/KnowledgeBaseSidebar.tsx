import React, { memo } from 'react';
import { DocumentInfo, CrawlJob, CrawlPage } from '../../types';
import { formatDisplayName, formatBytes } from '../../utils/formatters';

interface KnowledgeBaseSidebarProps {
  documents: DocumentInfo[];
  crawls?: CrawlJob[];
  isLoading: boolean;
  onReload: () => void;
}

function getDocIcon(doc: DocumentInfo): string {
  if (doc.sourceType === 'WEBSITE_IMPORT' || doc.sourceType === 'WEBSITE_CRAWL' || (doc.mimeType === 'text/markdown' && doc.sourceUrl)) {
    return '🌐';
  }
  if (doc.mimeType?.startsWith('image/')) {
    return '🖼️';
  }
  if (doc.sourceUrl) {
    return '🔗';
  }
  return '📄';
}

function formatCrawlStatus(status?: string): { label: string; className: string } {
  switch (status) {
    case 'queued':
      return { label: 'Queued', className: 'status-pending' };
    case 'discovering':
      return { label: 'Discovering', className: 'status-processing' };
    case 'processing_pages':
      return { label: 'Processing', className: 'status-processing' };
    case 'completed':
    case 'completed_with_errors':
      return { label: 'READY', className: 'status-ready' };
    case 'failed':
      return { label: 'FAILED', className: 'status-failed' };
    case 'cancelled':
      return { label: 'Cancelled', className: 'status-failed' };
    default:
      return { label: (status || 'READY').toUpperCase(), className: 'status-ready' };
  }
}

export const KnowledgeBaseSidebar: React.FC<KnowledgeBaseSidebarProps> = memo(({
  documents,
  crawls = [],
  isLoading,
  onReload,
}) => {
  // 1. Separate directly uploaded files from internally discovered child website routes
  const directDocuments = documents.filter(doc => doc.sourceType !== 'WEBSITE_CRAWL');
  const crawlChildDocuments = documents.filter(doc => doc.sourceType === 'WEBSITE_CRAWL');

  // 2. Identify parent website extractions (either from crawls prop or fallback deduplication)
  const parentCrawlsCount = crawls.length > 0
    ? crawls.length
    : crawlChildDocuments.length > 0
      ? 1
      : 0;

  const totalKnowledgeSources = directDocuments.length + parentCrawlsCount;
  const totalIndexedWebpages = crawlChildDocuments.filter(d => d.status === 'READY').length;

  return (
    <div className="card side-docs-card">
      <div className="side-docs-header">
        <h3>Portal Knowledge Base</h3>
        <button
          type="button"
          className="btn-secondary btn-xs btn-refresh-reactive"
          onClick={onReload}
          disabled={isLoading}
          title="Refresh indexed files"
        >
          <span className={isLoading ? 'spin-icon' : ''}>↻</span>
        </button>
      </div>

      {isLoading && totalKnowledgeSources > 0 && (
        <div style={{ height: '2px', width: '100%', marginBottom: '0.5rem' }} className="shimmer-block" />
      )}

      <p className="form-hint">
        {totalKnowledgeSources} knowledge source(s) indexed for this portal
        {crawlChildDocuments.length > 0 ? ` (${directDocuments.length} file(s), ${totalIndexedWebpages || crawlChildDocuments.length} web page(s)).` : '.'}
      </p>

      {isLoading && totalKnowledgeSources === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.75rem' }}>
          {[...Array(3)].map((_, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0' }}>
              <div style={{ width: '24px', height: '24px', borderRadius: '4px' }} className="shimmer-block" />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <div style={{ width: '70%', height: '14px' }} className="shimmer-block" />
                <div style={{ width: '40%', height: '10px' }} className="shimmer-block" />
              </div>
              <div style={{ width: '50px', height: '18px', borderRadius: '12px' }} className="shimmer-block" />
            </div>
          ))}
        </div>
      ) : totalKnowledgeSources === 0 ? (
        <div className="empty-state-small">
          No knowledge sources indexed yet. Upload files or import a website to start.
        </div>
      ) : (
        <ul className="side-doc-list">
          {/* Directly Uploaded Files (PDFs, DOCX, TXT, Images, direct URLs) */}
          {directDocuments.map(doc => {
            const formattedSize = formatBytes(doc.sizeBytes);
            return (
              <li key={doc.id} className="side-doc-item">
                <div className="side-doc-info">
                  <span className="side-doc-name" title={doc.originalFilename} style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={{ marginRight: '0.4rem', fontSize: '0.95rem' }}>{getDocIcon(doc)}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {formatDisplayName(doc.originalFilename, 26)}
                    </span>
                  </span>
                  <span className="side-doc-meta">
                    {formattedSize ? `${formattedSize} • ` : ''}
                    {new Date(doc.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <span className={`status-pill status-${doc.status.toLowerCase()}`}>
                  {doc.status}
                </span>
              </li>
            );
          })}

          {/* User-submitted Parent Website Crawl Jobs (Consolidated Base URLs) */}
          {crawls.length > 0 ? (
            crawls.map(crawl => {
              const statusInfo = formatCrawlStatus(crawl.status);
              const indexedCount = crawl.completedCount || 0;
              const totalCount = crawl.discoveredCount || indexedCount;

              return (
                <li key={crawl.id} className="side-doc-item side-crawl-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="side-doc-info" style={{ flex: 1, minWidth: 0 }}>
                      <span className="side-doc-name" title={crawl.rootUrl} style={{ display: 'flex', alignItems: 'center' }}>
                        <span style={{ marginRight: '0.4rem', fontSize: '0.95rem' }}>🌐</span>
                        <a
                          href={crawl.rootUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            color: '#0f172a',
                            textDecoration: 'none',
                            fontWeight: 600,
                          }}
                        >
                          {crawl.rootUrl}
                        </a>
                      </span>
                      <span className="side-doc-meta">
                        {indexedCount} page(s) indexed {totalCount > indexedCount ? `of ${totalCount} ` : ''}&bull; {new Date(crawl.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <span className={`status-pill ${statusInfo.className}`}>
                      {statusInfo.label}
                    </span>
                  </div>

                  {/* Secondary route details (collapsed by default, preserving child pages for inspection) */}
                  {Array.isArray(crawl.pages) && crawl.pages.length > 0 && (
                    <details className="side-crawl-routes-details" style={{ marginTop: '0.35rem', paddingTop: '0.35rem', borderTop: '1px dashed #e2e8f0', fontSize: '0.74rem' }}>
                      <summary style={{ cursor: 'pointer', color: '#64748b', outline: 'none' }}>
                        Inspect {crawl.pages.length} discovered route(s)
                      </summary>
                      <ul style={{ listStyle: 'none', paddingLeft: '0.5rem', margin: '0.35rem 0 0 0', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        {crawl.pages.slice(0, 8).map((p: CrawlPage) => (
                          <li key={p.id || p.normalizedUrl} style={{ display: 'flex', justifyContent: 'space-between', color: '#475569', gap: '0.5rem' }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '170px' }} title={p.normalizedUrl}>
                              {p.normalizedUrl.replace(/^https?:\/\/[^/]+/i, '') || '/'}
                            </span>
                            <span style={{ fontSize: '0.68rem', textTransform: 'capitalize', color: p.status === 'completed' ? '#16a34a' : p.status === 'failed' ? '#dc2626' : '#64748b' }}>
                              {p.status}
                            </span>
                          </li>
                        ))}
                        {crawl.pages.length > 8 && (
                          <li style={{ color: '#94a3b8', fontStyle: 'italic' }}>
                            + {crawl.pages.length - 8} more routes...
                          </li>
                        )}
                      </ul>
                    </details>
                  )}
                </li>
              );
            })
          ) : crawlChildDocuments.length > 0 ? (
            /* Fallback single parent website card if crawls list is not yet loaded */
            <li className="side-doc-item side-crawl-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="side-doc-info" style={{ flex: 1, minWidth: 0 }}>
                  <span className="side-doc-name" style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={{ marginRight: '0.4rem', fontSize: '0.95rem' }}>🌐</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
                      {crawlChildDocuments[0]?.sourceUrl
                        ? new URL(crawlChildDocuments[0].sourceUrl).origin
                        : 'Imported Website'}
                    </span>
                  </span>
                  <span className="side-doc-meta">
                    {crawlChildDocuments.length} page(s) indexed &bull; {new Date(crawlChildDocuments[0].createdAt).toLocaleDateString()}
                  </span>
                </div>
                <span className="status-pill status-ready">
                  READY
                </span>
              </div>
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
});

KnowledgeBaseSidebar.displayName = 'KnowledgeBaseSidebar';
export default KnowledgeBaseSidebar;
