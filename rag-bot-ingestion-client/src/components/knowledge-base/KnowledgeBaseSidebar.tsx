import React, { memo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { usePortal } from '../../context/PortalContext';
import { RefetchConfirmModal } from '../common/RefetchConfirmModal';
import { DocumentViewerModal } from '../common/DocumentViewerModal';
import { DocumentInfo, CrawlJob, CrawlPage } from '../../types';
import { formatDisplayName, formatBytes } from '../../utils/formatters';

interface KnowledgeBaseSidebarProps {
  documents: DocumentInfo[];
  crawls?: CrawlJob[];
  portalId?: string;
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
  if (doc.mimeType?.includes('pdf')) {
    return '📕';
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
  portalId,
  isLoading,
  onReload,
}) => {
  const { getClient } = useAuth();
  const { selectedPortal } = usePortal();
  const params = useParams<{ portalId?: string }>();
  const activePortalId = portalId || selectedPortal?.id || params.portalId || '';
  const [refetchCrawlTarget, setRefetchCrawlTarget] = useState<CrawlJob | null>(null);
  const [isRefetching, setIsRefetching] = useState(false);

  // Document Viewing State
  const [viewingDoc, setViewingDoc] = useState<DocumentInfo | null>(null);

  // Document Deletion State
  const [docToDelete, setDocToDelete] = useState<DocumentInfo | null>(null);
  const [isDeletingDoc, setIsDeletingDoc] = useState(false);

  // Crawl Deletion State (Phase 6)
  const [crawlToDelete, setCrawlToDelete] = useState<CrawlJob | null>(null);
  const [isDeletingCrawl, setIsDeletingCrawl] = useState(false);

  const handleConfirmRefetch = useCallback(async () => {
    if (!refetchCrawlTarget || !activePortalId) return;
    setIsRefetching(true);
    try {
      const client = getClient();
      await client.refetchPortalCrawl(activePortalId, refetchCrawlTarget.id);
      setRefetchCrawlTarget(null);
      onReload();
    } catch (err: any) {
      console.error('Refetch failed', err);
    } finally {
      setIsRefetching(false);
    }
  }, [refetchCrawlTarget, activePortalId, getClient, onReload]);

    const handleConfirmDeleteCrawl = useCallback(async () => {
    if (!crawlToDelete || !activePortalId) return;
    setIsDeletingCrawl(true);
    try {
      const client = getClient();
      await client.deletePortalCrawl(activePortalId, crawlToDelete.id);
      setCrawlToDelete(null);
      onReload();
    } catch (err: any) {
      console.error('Failed to delete website crawl', err);
    } finally {
      setIsDeletingCrawl(false);
    }
  }, [crawlToDelete, activePortalId, getClient, onReload]);

  const handleConfirmDeleteDoc = useCallback(async () => {
    if (!docToDelete || !activePortalId) return;
    setIsDeletingDoc(true);
    try {
      const client = getClient();
      await client.deletePortalDocument(activePortalId, docToDelete.id);
      setDocToDelete(null);
      onReload();
    } catch (err: any) {
      console.error('Failed to delete document', err);
    } finally {
      setIsDeletingDoc(false);
    }
  }, [docToDelete, activePortalId, getClient, onReload]);

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
                <div className="side-doc-info" style={{ flex: 1, minWidth: 0 }}>
                  <span
                    className="side-doc-name"
                    title={activePortalId ? `Click to view ${doc.originalFilename}` : doc.originalFilename}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      cursor: activePortalId ? 'pointer' : 'default',
                    }}
                    onClick={() => { if (activePortalId) setViewingDoc(doc); }}
                  >
                    <span style={{ marginRight: '0.4rem', fontSize: '0.95rem' }}>{getDocIcon(doc)}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {formatDisplayName(doc.originalFilename, 22)}
                    </span>
                  </span>
                  <span className="side-doc-meta">
                    {formattedSize ? `${formattedSize} • ` : ''}
                    {new Date(doc.createdAt).toLocaleDateString()}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span className={`status-pill status-${doc.status.toLowerCase()}`}>
                    {doc.status}
                  </span>
                  {activePortalId && (
                    <button
                      type="button"
                      className="btn-card-delete-icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDocToDelete(doc);
                      }}
                      title="Delete document source"
                      aria-label="Delete document source"
                      style={{ padding: '0.25rem', width: '28px', height: '28px' }}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <line x1="10" y1="11" x2="10" y2="17" />
                        <line x1="14" y1="11" x2="14" y2="17" />
                      </svg>
                    </button>
                  )}
                </div>
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
                          {crawl.rootUrl} ↗
                        </a>
                      </span>
                      <span className="side-doc-meta">
                        {indexedCount} page(s) indexed {totalCount > indexedCount ? `of ${totalCount} ` : ''}&bull; {new Date(crawl.createdAt).toLocaleDateString()}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span className={`status-pill ${statusInfo.className}`}>
                        {statusInfo.label}
                      </span>
                      {activePortalId && (
                        <button
                          type="button"
                          className="btn-card-refetch-icon"
                          onClick={() => setRefetchCrawlTarget(crawl)}
                          disabled={crawl.status === 'discovering' || crawl.status === 'processing_pages' || crawl.refetchStatus === 'refetching'}
                          title="Refetch website content"
                          aria-label="Refetch website content"
                          style={{ padding: '0.25rem', width: '28px', height: '28px' }}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            width="16"
                            height="16"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className={crawl.refetchStatus === 'refetching' ? 'spin-icon' : ''}
                          >
                            <polyline points="23 4 23 10 17 10" />
                            <polyline points="1 20 1 14 7 14" />
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                          </svg>
                        </button>
                      )}
                      {activePortalId && (
                        <button
                          type="button"
                          className="btn-card-delete-icon"
                          onClick={() => setCrawlToDelete(crawl)}
                          disabled={crawl.status === 'discovering' || crawl.status === 'processing_pages' || crawl.refetchStatus === 'refetching'}
                          title="Delete website source"
                          aria-label="Delete website source"
                          style={{ padding: '0.25rem', width: '28px', height: '28px' }}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            width="16"
                            height="16"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            <line x1="10" y1="11" x2="10" y2="17" />
                            <line x1="14" y1="11" x2="14" y2="17" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>

                  {crawl.lastRefetchedAt && (
                    <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.2rem' }}>
                      Last checked: {new Date(crawl.lastRefetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {crawl.refetchStatus === 'completed' && (crawl.changedCount ?? 0) === 0 && (crawl.newlyDiscoveredCount ?? 0) === 0 && (crawl.unchangedCount ?? 0) > 0 ? (
                        <span style={{ color: '#16a34a', marginLeft: '0.35rem', fontWeight: 500 }}>&bull; Up to date</span>
                      ) : crawl.changedCount ? (
                        <span style={{ color: '#2563eb', marginLeft: '0.35rem' }}>&bull; {crawl.changedCount} changed</span>
                      ) : null}
                    </div>
                  )}

                  {/* Secondary route details (collapsed by default, preserving child pages for inspection) */}
                  {Array.isArray(crawl.pages) && crawl.pages.length > 0 && (
                    <details className="side-crawl-routes-details" style={{ marginTop: '0.35rem', paddingTop: '0.35rem', borderTop: '1px dashed #e2e8f0', fontSize: '0.74rem' }}>
                      <summary style={{ cursor: 'pointer', color: '#64748b', outline: 'none' }}>
                        Inspect {crawl.pages.length} discovered route(s)
                      </summary>
                      <ul style={{ listStyle: 'none', paddingLeft: '0.5rem', margin: '0.35rem 0 0 0', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        {crawl.pages.slice(0, 8).map((p: CrawlPage) => (
                          <li key={p.id || p.normalizedUrl} style={{ display: 'flex', justifyContent: 'space-between', color: '#475569', gap: '0.5rem' }}>
                            <a
                              href={p.originalUrl || p.normalizedUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '170px', color: '#0284c7', textDecoration: 'none' }}
                              title={p.normalizedUrl}
                            >
                              {p.normalizedUrl.replace(/^https?:\/\/[^/]+/i, '') || '/'} ↗
                            </a>
                            <span style={{ fontSize: '0.68rem', textTransform: 'capitalize', color: p.status === 'completed' ? '#16a34a' : p.status === 'failed' ? '#dc2626' : '#64748b' }}>
                              {p.isUnchanged ? 'Unchanged' : p.status}
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

      {/* Refetch Confirmation Modal */}
      <RefetchConfirmModal
        crawl={refetchCrawlTarget}
        isRefetching={isRefetching}
        onCancel={() => setRefetchCrawlTarget(null)}
        onConfirm={handleConfirmRefetch}
      />

            {/* Website Crawl Delete Confirmation Modal (Phase 6) */}
      {crawlToDelete && typeof document !== 'undefined' && createPortal(
        <div
          className="modal-backdrop modal-overlay"
          onClick={() => setCrawlToDelete(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(15, 23, 42, 0.72)',
            backdropFilter: 'blur(4px)',
            padding: '1rem',
          }}
        >
          <div
            className="modal-dialog modal-card modal-delete"
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: '440px', width: '95%', margin: 'auto', position: 'relative', zIndex: 100000, boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.45)' }}
          >
            <div className="modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', margin: 0, fontSize: '1.1rem' }}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="#dc2626"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ marginRight: '0.4rem', flexShrink: 0 }}
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
                Delete Website Source
              </h3>
              <button
                type="button"
                className="btn-close"
                onClick={() => setCrawlToDelete(null)}
                disabled={isDeletingCrawl}
              >
                ✕
              </button>
            </div>
            <div className="modal-body" style={{ padding: '1rem 0' }}>
              <p>
                Are you sure you want to delete <strong>{crawlToDelete.rootUrl}</strong> and all its associated indexed pages from this portal?
              </p>
              <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.5rem' }}>
                This action cannot be undone. All extracted pages, chunks, and embeddings will be permanently removed.
              </p>
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setCrawlToDelete(null)}
                disabled={isDeletingCrawl}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger btn-delete-confirm"
                onClick={handleConfirmDeleteCrawl}
                disabled={isDeletingCrawl}
              >
                {isDeletingCrawl ? 'Deleting...' : 'Delete Source'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Document Viewer Modal */}
      {viewingDoc && activePortalId && (
        <DocumentViewerModal
          isOpen={Boolean(viewingDoc)}
          onClose={() => setViewingDoc(null)}
          portalId={activePortalId}
          documentId={viewingDoc.id}
          documentTitle={viewingDoc.originalFilename}
          mimeType={viewingDoc.mimeType}
        />
      )}

      {/* Document Delete Confirmation Modal */}
      {docToDelete && typeof document !== 'undefined' && createPortal(
        <div
          className="modal-backdrop modal-overlay"
          onClick={() => setDocToDelete(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(15, 23, 42, 0.72)',
            backdropFilter: 'blur(4px)',
            padding: '1rem',
          }}
        >
          <div
            className="modal-dialog modal-card modal-delete"
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: '440px', width: '95%', margin: 'auto', position: 'relative', zIndex: 100000, boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.45)' }}
          >
            <div className="modal-header">
              <h3 style={{ display: 'flex', alignItems: 'center', margin: 0, fontSize: '1.1rem' }}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="#dc2626"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ marginRight: '0.4rem', flexShrink: 0 }}
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
                Delete Document
              </h3>
              <button
                type="button"
                className="btn-close"
                onClick={() => setDocToDelete(null)}
                disabled={isDeletingDoc}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p>
                Are you sure you want to delete <strong>{docToDelete.originalFilename}</strong> from this portal?
              </p>
              <p style={{ fontSize: '0.8rem', color: '#64748b' }}>
                This will remove the file, its versions, and all associated vector embeddings from search results.
              </p>
            </div>
            <div className="modal-footer modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setDocToDelete(null)}
                disabled={isDeletingDoc}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger btn-delete-confirm"
                onClick={handleConfirmDeleteDoc}
                disabled={isDeletingDoc}
              >
                {isDeletingDoc ? 'Deleting...' : 'Delete Document'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
});

KnowledgeBaseSidebar.displayName = 'KnowledgeBaseSidebar';
export default KnowledgeBaseSidebar;
