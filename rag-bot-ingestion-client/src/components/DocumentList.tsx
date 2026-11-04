import React from 'react';
import { IngestionJob, IngestionJobDocument, CrawlJob } from '../types';

function truncateName(name: string, maxLen = 26): string {
  if (!name) return 'Document';
  let clean = name.split('?')[0].split('#')[0];
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

function getImpactingStatus(
  doc: IngestionJobDocument,
  crawls?: CrawlJob[],
  job?: IngestionJob | null
): { label: string; className: string } {
  const isCrawl =
    doc.sourceType === 'WEBSITE_CRAWL' ||
    doc.downloadMetadata?.sourceType === 'webpage' ||
    Boolean(doc.downloadMetadata?.crawlJobId);

  // If this document represents a multi-page website crawl, its status must reflect the overall crawl lifecycle
  if (isCrawl) {
    const crawlId = doc.downloadMetadata?.crawlJobId || doc.jobId;
    const crawl = crawls?.find(c => c.id === crawlId);
    const crawlStatus = crawl?.status || (job?.id === crawlId ? job?.status?.toLowerCase() : undefined);

    if (crawlStatus === 'failed' || ((crawl?.discoveredCount || 0) > 0 && crawl?.failedCount === crawl?.discoveredCount)) {
      return { label: 'FAILED', className: 'status-failed' };
    }
    if (crawlStatus === 'completed' || (crawl && crawl.queuedCount === 0 && crawl.processingCount === 0 && (crawl.discoveredCount || 0) > 0)) {
      return { label: 'READY', className: 'status-ready' };
    }
    if (crawlStatus === 'discovering') {
      return { label: 'DISCOVERING', className: 'status-processing' };
    }
    if (crawlStatus === 'processing_pages' || (crawl && (crawl.processingCount > 0 || crawl.queuedCount > 0))) {
      return { label: 'PROCESSING', className: 'status-processing' };
    }
    if (job?.status === 'READY') {
      return { label: 'READY', className: 'status-ready' };
    }
    if (job?.status === 'PROCESSING') {
      return { label: 'PROCESSING', className: 'status-processing' };
    }
  }

  const { status, stage } = doc;
  // If failed anywhere (either terminal failure status or early failure stage)
  if (stage === 'NO_CONTENT_FOUND') {
    return { label: 'NO CONTENT FOUND', className: 'status-failed' };
  }
  if (status === 'FAILED' || stage === 'DOWNLOAD_FAILED' || stage === 'FAILED') {
    return { label: 'FAILED', className: 'status-failed' };
  }

  // If completed and ready for vector search
  if (status === 'READY') {
    return { label: 'READY', className: 'status-ready' };
  }

  // If currently processing, show the active stage or processing
  if (stage === 'FETCHING_PAGE') {
    return { label: 'FETCHING PAGE', className: 'status-processing' };
  }
  if (stage === 'EXTRACTING_CONTENT') {
    return { label: 'EXTRACTING', className: 'status-processing' };
  }
  if (stage === 'DOWNLOADING') {
    return { label: 'DOWNLOADING', className: 'status-processing' };
  }
  if (stage === 'UPLOADED_TO_S3') {
    return { label: 'UPLOADED TO S3', className: 'status-processing' };
  }
  if (status === 'PROCESSING') {
    return { label: 'PROCESSING', className: 'status-processing' };
  }

  // If pending or queued
  if (stage === 'QUEUED_FOR_DOWNLOAD') {
    return { label: 'QUEUED', className: 'status-pending' };
  }

  return { label: (status || 'PENDING').toUpperCase(), className: 'status-pending' };
}

function getSourceCategory(doc: IngestionJobDocument): { label: string; icon: string; className: string } {
  const mime = doc.document?.mimeType || '';
  const url = doc.sourceUrl || '';
  const isImage = mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg|bmp|tiff)$/i.test(url.split('?')[0]);

  if (
    doc.downloadMetadata?.sourceType === 'webpage' ||
    doc.sourceType === 'WEBSITE_IMPORT' ||
    doc.sourceType === 'WEBSITE_CRAWL'
  ) {
    return { label: 'Webpage', icon: '🌐', className: 'source-tag-web' };
  }
  if (doc.sourceUrl) {
    if (isImage) {
      return { label: 'Photo URL', icon: '🖼️', className: 'source-tag-image' };
    }
    return { label: 'File URL', icon: '🔗', className: 'source-tag-url' };
  }
  if (isImage) {
    return { label: 'Photo Upload', icon: '🖼️', className: 'source-tag-image' };
  }
  return { label: 'File Upload', icon: '📁', className: 'source-tag-file' };
}

interface DocumentListProps {
  documents: IngestionJobDocument[];
  job?: IngestionJob | null;
  crawls?: CrawlJob[];
  onRetryUrl?: (url: string) => void;
}

export const DocumentList: React.FC<DocumentListProps> = ({ documents, job, crawls, onRetryUrl }) => {
  // Only display user-entered records for this session, not recursive crawl routes
  const userSessionDocs = React.useMemo(() => {
    return documents.filter(doc => {
      if (doc.sourceType !== 'WEBSITE_CRAWL' && !doc.downloadMetadata?.crawlJobId) {
        return true;
      }
      return doc.downloadMetadata?.depth === 0 || doc.downloadMetadata?.source === 'root';
    });
  }, [documents]);

  if (userSessionDocs.length === 0) return null;

  return (
    <div className="card documents-card">
      <h3>Documents Ingestion Breakdown</h3>
      <div className="documents-table-wrapper">
        <table className="documents-table">
          <thead>
            <tr>
              <th>Document / Source</th>
              <th>Type</th>
              <th>Status</th>
              <th>Details / Stage Info</th>
              {onRetryUrl && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {userSessionDocs.map(doc => {
              const isDownloadFailure = doc.stage === 'DOWNLOAD_FAILED';
              const isIngestionFailure = doc.status === 'FAILED' && !isDownloadFailure;
              const rawName = doc.document?.originalFilename || (doc.sourceUrl ? doc.sourceUrl.split('/').pop()?.split('?')[0] : '') || `Doc ${doc.documentId.substring(0, 8)}`;
              const displayName = truncateName(rawName, 26);
              const impactingStatus = getImpactingStatus(doc, crawls, job);
              const sourceCategory = getSourceCategory(doc);

              const isCrawl =
                doc.sourceType === 'WEBSITE_CRAWL' ||
                doc.downloadMetadata?.sourceType === 'webpage' ||
                Boolean(doc.downloadMetadata?.crawlJobId);
              const crawlId = doc.downloadMetadata?.crawlJobId || doc.jobId;
              const crawl = crawls?.find(c => c.id === crawlId);
              const crawlStatus = crawl?.status || (job?.id === crawlId ? job?.status?.toLowerCase() : undefined);

              return (
                <tr key={doc.id}>
                  <td className="doc-name">
                    {doc.sourceUrl ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', minWidth: 0, maxWidth: '240px' }}>
                        <span style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={rawName}>
                          {displayName}
                        </span>
                        <a
                          href={doc.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={doc.sourceUrl}
                          style={{
                            fontSize: '0.78rem',
                            color: 'var(--primary)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            display: 'inline-block',
                            maxWidth: '230px',
                          }}
                        >
                          🔗 {doc.sourceUrl}
                        </a>
                      </div>
                    ) : (
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block', maxWidth: '240px' }} title={rawName}>
                        {displayName}
                      </span>
                    )}
                  </td>
                  <td className="doc-mime">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <span className={`source-type-badge ${sourceCategory.className}`}>
                        {sourceCategory.icon} {sourceCategory.label}
                      </span>
                      <span style={{ fontSize: '0.74rem', color: '#64748b' }}>
                        {doc.document?.mimeType || 'auto-detect'}
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className={`status-pill ${impactingStatus.className}`}>
                      {impactingStatus.label}
                    </span>
                  </td>
                  <td className="doc-error">
                    {isDownloadFailure ? (
                      <span className="error-text">⚠️ Download Error: {doc.errorMessage}</span>
                    ) : doc.stage === 'NO_CONTENT_FOUND' ? (
                      <span className="error-text">⚠️ No meaningful static content found (SPA / JS shell)</span>
                    ) : isIngestionFailure ? (
                      <span className="error-text">⚠️ Ingestion Error: {doc.errorMessage}</span>
                    ) : isCrawl && crawlStatus === 'discovering' ? (
                      <span style={{ color: '#d97706' }}>🌐 Discovering internal website routes...</span>
                    ) : isCrawl && (crawlStatus === 'processing_pages' || impactingStatus.label === 'PROCESSING') ? (
                      <span style={{ color: '#0284c7' }}>
                        ⚙️ Extracting & indexing pages {crawl?.discoveredCount ? `(${crawl.completedCount || 0}/${crawl.discoveredCount})` : ''}...
                      </span>
                    ) : isCrawl && impactingStatus.label === 'READY' ? (
                      <span className="success-text">
                        ✓ Grounded & Indexed in pgvector {crawl?.completedCount ? `(${crawl.completedCount} pages)` : ''}
                      </span>
                    ) : doc.status === 'READY' ? (
                      <span className="success-text">✓ Grounded & Indexed in pgvector</span>
                    ) : doc.stage === 'UPLOADED_TO_S3' ? (
                      <span style={{ color: '#0284c7' }}>☁️ Stored in S3, queuing ingestion...</span>
                    ) : doc.stage === 'FETCHING_PAGE' ? (
                      <span style={{ color: '#d97706' }}>🌐 Fetching public webpage HTML...</span>
                    ) : doc.stage === 'EXTRACTING_CONTENT' ? (
                      <span style={{ color: '#0284c7' }}>📄 Extracting static content & markdown...</span>
                    ) : doc.stage === 'DOWNLOADING' ? (
                      <span style={{ color: '#d97706' }}>⬇️ Securely downloading from URL...</span>
                    ) : (
                      <span>Processing pipeline...</span>
                    )}
                  </td>
                  {onRetryUrl && (
                    <td>
                      {(isDownloadFailure || isIngestionFailure || doc.stage === 'NO_CONTENT_FOUND') && doc.sourceUrl && (
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                          onClick={() => onRetryUrl(doc.sourceUrl!)}
                        >
                          🔄 Retry
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
