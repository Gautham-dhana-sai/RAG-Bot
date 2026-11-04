import React, { memo, useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Portal, CrawlJob, CrawlPage, IngestionJobDocument, DocumentInfo } from '../../types';
import { formatBytes } from '../../utils/formatters';

interface WebsiteImportSectorProps {
  portal: Portal;
  portalDocuments?: DocumentInfo[];
  jobDocuments?: IngestionJobDocument[];
  onRetryUrl?: (url: string) => void;
  onJobStarted?: (jobId: string) => void;
  onDocumentsUpdated?: () => void;
  isSubmitting?: boolean;
}

function formatCrawlJobStatus(status?: string): { label: string; className: string } {
  switch (status) {
    case 'queued':
      return { label: 'Queued', className: 'status-pending' };
    case 'discovering':
      return { label: 'Discovering Routes...', className: 'status-processing' };
    case 'processing_pages':
      return { label: 'Processing Pages', className: 'status-processing' };
    case 'completed':
    case 'completed_with_errors':
      return { label: 'Completed', className: 'status-ready' };
    case 'failed':
      return { label: 'Failed', className: 'status-failed' };
    case 'cancelled':
      return { label: 'Cancelled', className: 'status-failed' };
    default:
      return { label: (status || 'PENDING').toUpperCase(), className: 'status-pending' };
  }
}

function formatPageStatus(status?: string, stage?: string): { label: string; className: string } {
  if (status === 'skipped' || stage === 'NO_CONTENT_FOUND') {
    return { label: 'Skipped (SPA / No Text)', className: 'status-skipped' };
  }
  if (status === 'failed' || stage === 'DOWNLOAD_FAILED' || stage === 'FAILED' || stage === 'NOT_FOUND' || stage === 'ACCESS_DENIED') {
    return { label: stage === 'NOT_FOUND' ? 'Not Found (404)' : 'Failed', className: 'status-failed' };
  }
  if (status === 'completed' || stage === 'READY') {
    return { label: 'Indexed', className: 'status-ready' };
  }
  if (status === 'uploaded' || stage === 'UPLOADED_TO_S3' || stage === 'PROCESSING') {
    return { label: 'Ingesting Chunks', className: 'status-processing' };
  }
  if (status === 'fetching' || stage === 'FETCHING_PAGE') {
    return { label: 'Fetching', className: 'status-processing' };
  }
  if (status === 'extracting' || stage === 'EXTRACTING_CONTENT') {
    return { label: 'Extracting', className: 'status-processing' };
  }
  if (status === 'queued' || stage === 'QUEUED_FOR_DOWNLOAD') {
    return { label: 'Queued', className: 'status-pending' };
  }
  return { label: (status || 'Discovered').toUpperCase(), className: 'status-pending' };
}

export const WebsiteImportSector: React.FC<WebsiteImportSectorProps> = memo(({
  portal,
  jobDocuments = [],
  onDocumentsUpdated,
  onJobStarted,
  isSubmitting = false,
}) => {
  const { getClient } = useAuth();

  // Single URL Input State
  const [urlInput, setUrlInput] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [isSubmittingInternal, setIsSubmittingInternal] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Parent Website Crawl Jobs
  const [crawls, setCrawls] = useState<CrawlJob[]>([]);
  const [isLoadingCrawls, setIsLoadingCrawls] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [retryingKeys, setRetryingKeys] = useState<Record<string, boolean>>({});

  const pollingRef = useRef<any>(null);
  const crawlStatusSignatureRef = useRef<string>('');

  // Fetch crawl jobs with detailed child pages
  const fetchCrawlsData = useCallback(async (manualRefresh = false) => {
    if (manualRefresh) {
      setIsRefreshing(true);
    }
    try {
      const client = getClient();
      const list = await client.listPortalCrawls(portal.id);
      if (Array.isArray(list)) {
        // Fetch detailed pages for running or recent crawls
        const detailedList = await Promise.all(
          list.map(async item => {
            if (
              item.status === 'queued' ||
              item.status === 'discovering' ||
              item.status === 'processing_pages' ||
              !item.pages ||
              item.pages.length === 0
            ) {
              try {
                return await client.getPortalCrawl(portal.id, item.id);
              } catch {
                return item;
              }
            }
            return item;
          })
        );
        setCrawls(detailedList);

        // Reactively notify parent whenever crawl lifecycle status or page completion changes
        const currentSignature = detailedList
          .map(item => `${item.id}:${item.status}:${item.completedCount || 0}:${item.failedCount || 0}:${item.processingCount || 0}`)
          .join('|');

        if (crawlStatusSignatureRef.current !== currentSignature) {
          const isInitialRun = crawlStatusSignatureRef.current === '';
          crawlStatusSignatureRef.current = currentSignature;
          if (!isInitialRun && onDocumentsUpdated) {
            onDocumentsUpdated();
          }
        }
      }
    } catch {
      // ignore
    } finally {
      if (manualRefresh) {
        setIsRefreshing(false);
      }
    }
  }, [getClient, portal.id, onDocumentsUpdated]);

  // Initial load
  useEffect(() => {
    setIsLoadingCrawls(true);
    fetchCrawlsData().finally(() => setIsLoadingCrawls(false));
  }, [fetchCrawlsData]);

  // Dynamic Polling: poll every 3 seconds while ANY crawl is running; stop when all are terminal
  // NOTE: Does NOT reload the Knowledge Base sidebar on interval, only updates the crawl cards internally!
  useEffect(() => {
    const hasRunningCrawl = crawls.some(
      c => c.status === 'queued' || c.status === 'discovering' || c.status === 'processing_pages'
    );

    if (!hasRunningCrawl) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    if (!pollingRef.current) {
      pollingRef.current = setInterval(async () => {
        await fetchCrawlsData(false);
      }, 3000);
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [crawls, fetchCrawlsData]);

  // Submit Website Root URL (Parent Crawl)
  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = urlInput.trim();
    if (!trimmed) {
      setInputError('Please enter a website URL to import.');
      return;
    }

    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        setInputError('Please enter a valid HTTP or HTTPS website URL.');
        return;
      }
      if (!parsed.hostname || parsed.hostname.length < 3) {
        setInputError('Please enter a valid website hostname (e.g., https://example.com).');
        return;
      }
    } catch {
      setInputError('Please enter a valid, well-formed website URL.');
      return;
    }

    setInputError(null);
    setSuccessMessage(null);
    setIsSubmittingInternal(true);

    try {
      const client = getClient();
      const res = await client.startPortalCrawl(portal.id, {
        url: trimmed,
        maxPages: 30,
        maxDepth: 3,
      });

      const crawlJobId = res.crawlJobId || res.jobId;
      if (crawlJobId) {
        if (onJobStarted) {
          onJobStarted(crawlJobId);
        }
        // Immediately fetch newly initiated parent crawl job
        const initialJob = await client.getPortalCrawl(portal.id, crawlJobId);
        setCrawls(prev => [initialJob, ...prev.filter(c => c.id !== crawlJobId)]);
      }

      setSuccessMessage(`Website extraction initiated for "${trimmed}". Discovering nested pages and indexing content...`);
      setUrlInput('');
      if (onDocumentsUpdated) {
        onDocumentsUpdated();
      }
    } catch (err: any) {
      setInputError(err.message || 'Website analysis failed. Please verify the URL and try again.');
    } finally {
      setIsSubmittingInternal(false);
    }
  }, [urlInput, getClient, portal.id, onJobStarted, onDocumentsUpdated]);

  // Retry an individual page or all failed pages for a parent crawl
  const handleRetryCrawl = useCallback(async (crawlId: string, pageUrl?: string) => {
    const retryKey = `${crawlId}_${pageUrl || 'ALL'}`;
    setRetryingKeys(prev => ({ ...prev, [retryKey]: true }));
    try {
      const client = getClient();
      await client.retryPortalCrawl(portal.id, crawlId, pageUrl);
      const updated = await client.getPortalCrawl(portal.id, crawlId);
      setCrawls(prev => prev.map(c => (c.id === crawlId ? updated : c)));
      if (onDocumentsUpdated) {
        onDocumentsUpdated();
      }
    } catch (err: any) {
      setInputError(err.message || 'Failed to retry webpage processing.');
    } finally {
      setRetryingKeys(prev => ({ ...prev, [retryKey]: false }));
    }
  }, [getClient, portal.id, onDocumentsUpdated]);

  const submitting = isSubmitting || isSubmittingInternal;

  // Filter standalone single-page imports that do not belong to a crawl job
  const standaloneWebpages = jobDocuments.filter(jd => {
    return jd.sourceUrl && jd.downloadMetadata?.sourceType !== 'webpage' && !jd.downloadMetadata?.crawlJobId;
  });

  return (
    <div className="website-import-container">
      {/* Guidance */}
      <div className="form-hint" style={{ marginBottom: '1.25rem' }}>
        <strong>Multi-Page Website Crawling &amp; Ingestion:</strong> Enter any website root URL to ingest into <strong>{portal.name}</strong>. PersonaRAG discovers internal routes within the permitted boundary, extracts static HTML content, uploads normalized Markdown to storage, and generates vector embeddings for AI chat answers.
        <div style={{ marginTop: '0.4rem', fontSize: '0.78rem', color: '#64748b' }}>
          ℹ️ Public static HTML pages are crawled. Single-page application (SPA) client shells without static text are detected and safely skipped.
        </div>
      </div>

      {/* Root Base URL Submission Form */}
      <form onSubmit={handleSubmit} className="website-submission-form">
        <div className="url-input-row" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <input
            type="url"
            className={`qa-input ${inputError ? 'input-field-has-error' : ''}`}
            placeholder="https://example.com or https://docs.example.com"
            value={urlInput}
            onChange={e => {
              setUrlInput(e.target.value);
              if (inputError) setInputError(null);
            }}
            disabled={submitting}
            style={{ flex: 1 }}
          />
          <button
            type="submit"
            className="btn-primary"
            disabled={submitting || !urlInput.trim()}
            style={{ whiteSpace: 'nowrap', padding: '0.65rem 1.25rem' }}
          >
            {submitting ? 'Initiating Crawl...' : '🌐 Start Website Crawl'}
          </button>
        </div>

        {inputError && (
          <div className="alert-box alert-error" style={{ marginTop: '0.75rem' }}>
            {inputError}
          </div>
        )}
        {successMessage && (
          <div className="alert-box alert-success" style={{ marginTop: '0.75rem' }}>
            {successMessage}
          </div>
        )}
      </form>

      {/* Submitted Parent Website Jobs List */}
      <div className="parent-crawls-section" style={{ marginTop: '2.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h4 style={{ margin: 0, fontSize: '1.05rem', color: '#1e293b' }}>
            Website Extractions ({crawls.length})
          </h4>
          <button
            type="button"
            className="btn-secondary btn-sm btn-refresh-reactive"
            onClick={() => fetchCrawlsData(true)}
            disabled={isLoadingCrawls || isRefreshing}
            title="Refresh website extractions status"
          >
            {isRefreshing ? (
              <>
                <span className="spin-icon">↻</span> Refreshing...
              </>
            ) : (
              '🔄 Refresh Status'
            )}
          </button>
        </div>

        {/* Shimmer loading bar when refreshing */}
        {isRefreshing && (
          <div style={{ height: '3px', width: '100%', marginBottom: '1rem' }} className="shimmer-block" />
        )}

        {isLoadingCrawls && crawls.length === 0 ? (
          /* Shimmer Skeleton Placeholder while first loading */
          <div className="crawls-stack" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div
              className="crawl-job-card"
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                padding: '1.25rem',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                <div style={{ width: '220px', height: '22px' }} className="shimmer-block" />
                <div style={{ width: '90px', height: '22px' }} className="shimmer-block" />
              </div>
              <div style={{ width: '100%', height: '8px', marginBottom: '1rem' }} className="shimmer-block" />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: '0.5rem' }}>
                {[...Array(6)].map((_, idx) => (
                  <div key={idx} style={{ height: '52px' }} className="shimmer-block" />
                ))}
              </div>
            </div>
          </div>
        ) : crawls.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1', color: '#64748b' }}>
            No websites submitted yet. Enter a base URL above to start an automated static crawl.
          </div>
        ) : (
          <div className="crawls-stack" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {crawls.map(crawl => {
              const isDiscovering = crawl.status === 'discovering';
              const totalDiscovered = crawl.discoveredCount || 0;
              const completedCount = crawl.completedCount || 0;
              const skippedCount = crawl.skippedCount || 0;
              const failedCount = crawl.failedCount || 0;
              const processingCount = crawl.processingCount || 0;
              const queuedCount = crawl.queuedCount || 0;

              const finishedCount = completedCount + skippedCount + failedCount;
              const progressPercent = totalDiscovered > 0
                ? Math.min(100, Math.round((finishedCount / totalDiscovered) * 100))
                : 0;

              const isAllRetryRunning = retryingKeys[`${crawl.id}_ALL`];

              return (
                <div
                  key={crawl.id}
                  className="crawl-job-card"
                  style={{
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    padding: '1.25rem',
                    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
                  }}
                >
                  {/* Card Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '1.2rem' }}>🌐</span>
                        <a
                          href={crawl.rootUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0f172a', textDecoration: 'none' }}
                        >
                          {crawl.rootUrl}
                        </a>
                      </div>
                      <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.25rem' }}>
                        Job ID: <code>{crawl.id}</code> &bull; Started {new Date(crawl.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <span className={`status-pill ${formatCrawlJobStatus(crawl.status).className}`}>
                        {formatCrawlJobStatus(crawl.status).label}
                      </span>
                      {(failedCount > 0 || skippedCount > 0) && (
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          onClick={() => handleRetryCrawl(crawl.id)}
                          disabled={isAllRetryRunning}
                          style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
                        >
                          {isAllRetryRunning ? 'Retrying...' : '🔄 Retry Failed Pages'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Dynamic Progress Bar */}
                  <div style={{ marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#475569', marginBottom: '0.35rem' }}>
                      <span>
                        {isDiscovering && totalDiscovered === 0
                          ? '🔍 Discovering sitemap and internal routes...'
                          : `Extraction Progress: ${progressPercent}% (${completedCount} of ${totalDiscovered} pages indexed)`}
                      </span>
                      <span style={{ fontWeight: 600 }}>{progressPercent}%</span>
                    </div>

                    <div style={{ height: '8px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${progressPercent}%`,
                          background: crawl.status === 'failed' ? '#ef4444' : crawl.status === 'completed' ? '#16a34a' : 'var(--primary, #3b82f6)',
                          transition: 'width 0.4s ease',
                        }}
                      />
                    </div>
                  </div>

                  {/* Metric Badges */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))',
                      gap: '0.5rem',
                      marginBottom: '1rem',
                    }}
                  >
                    <div style={{ padding: '0.5rem', textAlign: 'center', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#334155' }}>{totalDiscovered}</div>
                      <div style={{ fontSize: '0.68rem', color: '#64748b', textTransform: 'uppercase' }}>Discovered</div>
                    </div>
                    <div style={{ padding: '0.5rem', textAlign: 'center', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0284c7' }}>{queuedCount}</div>
                      <div style={{ fontSize: '0.68rem', color: '#64748b', textTransform: 'uppercase' }}>Queued</div>
                    </div>
                    <div style={{ padding: '0.5rem', textAlign: 'center', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#eab308' }}>{processingCount}</div>
                      <div style={{ fontSize: '0.68rem', color: '#64748b', textTransform: 'uppercase' }}>Processing</div>
                    </div>
                    <div style={{ padding: '0.5rem', textAlign: 'center', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#16a34a' }}>{completedCount}</div>
                      <div style={{ fontSize: '0.68rem', color: '#64748b', textTransform: 'uppercase' }}>Indexed</div>
                    </div>
                    <div style={{ padding: '0.5rem', textAlign: 'center', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#d97706' }}>{skippedCount}</div>
                      <div style={{ fontSize: '0.68rem', color: '#64748b', textTransform: 'uppercase' }}>Skipped</div>
                    </div>
                    <div style={{ padding: '0.5rem', textAlign: 'center', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#dc2626' }}>{failedCount}</div>
                      <div style={{ fontSize: '0.68rem', color: '#64748b', textTransform: 'uppercase' }}>Failed</div>
                    </div>
                  </div>

                  {/* Expandable Accordion: Inspect Discovered Routes */}
                  <details
                    className="crawl-routes-details"
                    style={{ borderTop: '1px solid #f1f5f9', paddingTop: '0.75rem' }}
                    onToggle={async e => {
                      if ((e.target as HTMLDetailsElement).open && (!crawl.pages || crawl.pages.length === 0)) {
                        try {
                          const client = getClient();
                          const full = await client.getPortalCrawl(portal.id, crawl.id);
                          setCrawls(prev => prev.map(c => (c.id === crawl.id ? full : c)));
                        } catch {
                          // ignore
                        }
                      }
                    }}
                  >
                    <summary
                      style={{
                        cursor: 'pointer',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        color: 'var(--primary, #3b82f6)',
                        userSelect: 'none',
                        outline: 'none',
                      }}
                    >
                      Inspect Discovered Routes ({crawl.pages?.length || totalDiscovered})
                    </summary>

                    <div style={{ marginTop: '0.75rem', overflowX: 'auto' }}>
                      {(!crawl.pages || crawl.pages.length === 0) ? (
                        <div style={{ padding: '1rem', fontSize: '0.82rem', color: '#64748b', textAlign: 'center' }}>
                          {isDiscovering ? 'Discovery currently in progress...' : 'No route breakdown available.'}
                        </div>
                      ) : (
                        <table className="documents-table" style={{ fontSize: '0.82rem', margin: 0 }}>
                          <thead>
                            <tr>
                              <th>Route URL / Path</th>
                              <th>Title</th>
                              <th>Status</th>
                              <th>Size</th>
                              <th>Result / Error</th>
                              <th>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {crawl.pages.map((page: CrawlPage) => {
                              const pageStatusInfo = formatPageStatus(page.status, page.stage);
                              const isPageFailed = page.status === 'failed' || page.status === 'skipped';
                              const isThisPageRetrying = retryingKeys[`${crawl.id}_${page.originalUrl}`];

                              return (
                                <tr key={page.id || page.normalizedUrl}>
                                  <td>
                                    <a
                                      href={page.originalUrl || page.normalizedUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{ color: '#0284c7', textDecoration: 'none', wordBreak: 'break-all' }}
                                    >
                                      {page.normalizedUrl || page.originalUrl}
                                    </a>
                                  </td>
                                  <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {page.title || 'Webpage'}
                                  </td>
                                  <td>
                                    <span className={`status-pill ${pageStatusInfo.className}`} style={{ fontSize: '0.7rem' }}>
                                      {pageStatusInfo.label}
                                    </span>
                                  </td>
                                  <td style={{ color: '#64748b' }}>
                                    {page.sizeBytes ? formatBytes(page.sizeBytes) : '—'}
                                  </td>
                                  <td style={{ maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {page.errorMessage ? (
                                      <span className="error-text" title={page.errorMessage}>
                                        ⚠️ {page.errorMessage}
                                      </span>
                                    ) : (page.status === 'completed' || page.stage === 'READY') ? (
                                      <span className="success-text">✓ Grounded in pgvector</span>
                                    ) : (page.status === 'uploaded' || page.stage === 'UPLOADED_TO_S3' || page.stage === 'PROCESSING') ? (
                                      <span style={{ color: '#0284c7' }}>Ingesting embeddings...</span>
                                    ) : (
                                      <span style={{ color: '#64748b' }}>{page.stage || page.status}</span>
                                    )}
                                  </td>
                                  <td>
                                    {isPageFailed && (
                                      <button
                                        type="button"
                                        className="btn-secondary btn-sm"
                                        style={{ padding: '0.15rem 0.45rem', fontSize: '0.72rem' }}
                                        onClick={() => handleRetryCrawl(crawl.id, page.originalUrl)}
                                        disabled={isThisPageRetrying}
                                      >
                                        {isThisPageRetrying ? 'Retrying...' : '🔄 Retry'}
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </details>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Standalone Individual Webpages Section (if any non-crawl pages exist) */}
      {standaloneWebpages.length > 0 && (
        <div style={{ marginTop: '2.5rem' }}>
          <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem', color: '#475569' }}>
            Standalone Webpages ({standaloneWebpages.length})
          </h4>
          <div className="documents-table-wrapper">
            <table className="documents-table" style={{ fontSize: '0.82rem' }}>
              <thead>
                <tr>
                  <th>URL</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {standaloneWebpages.map(doc => (
                  <tr key={doc.id}>
                    <td>
                      <a href={doc.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#0284c7' }}>
                        {doc.sourceUrl}
                      </a>
                    </td>
                    <td>
                      <span className={`status-pill ${doc.status === 'READY' ? 'status-ready' : 'status-processing'}`}>
                        {doc.status}
                      </span>
                    </td>
                    <td style={{ color: '#64748b' }}>
                      {new Date(doc.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
});

WebsiteImportSector.displayName = 'WebsiteImportSector';
