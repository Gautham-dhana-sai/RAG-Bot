import React, { memo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../context/AuthContext';

export interface DocumentViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  portalId: string;
  documentId: string;
  documentTitle?: string;
  mimeType?: string;
  initialPage?: number;
}

export const DocumentViewerModal: React.FC<DocumentViewerModalProps> = memo(({
  isOpen,
  onClose,
  portalId,
  documentId,
  documentTitle = 'Document Preview',
  mimeType = 'text/plain',
  initialPage,
}) => {
  const { getClient } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contentUrl, setContentUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [resolvedMimeType, setResolvedMimeType] = useState<string>(mimeType);

  useEffect(() => {
    if (!isOpen || !portalId || !documentId) {
      setContentUrl(null);
      setTextContent(null);
      setError(null);
      return;
    }

    let active = true;
    let createdUrl: string | null = null;
    setLoading(true);
    setError(null);

    const loadContent = async () => {
      try {
        const client = getClient();
        const res = await client.fetchDocumentContentBlob(portalId, documentId);
        if (!active) {
          URL.revokeObjectURL(res.url);
          return;
        }
        createdUrl = res.url;
        setContentUrl(res.url);
        setResolvedMimeType(res.mimeType || mimeType);
        if (res.text) {
          setTextContent(res.text);
        }
      } catch (err: any) {
        if (active) {
          setError(err.message || 'Unable to load document content.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadContent();

    return () => {
      active = false;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [isOpen, portalId, documentId, getClient, mimeType]);

  if (!isOpen) return null;

  const isPdf = resolvedMimeType.includes('pdf');
  const isImage = resolvedMimeType.startsWith('image/');
  const isTextOrMarkdown =
    resolvedMimeType.includes('text') ||
    resolvedMimeType.includes('markdown') ||
    resolvedMimeType.includes('json') ||
    resolvedMimeType.includes('csv');

  const pdfUrlWithPage = contentUrl
    ? initialPage && initialPage > 1
      ? `${contentUrl}#page=${initialPage}`
      : contentUrl
    : '';

  const modalContent = (
    <div
      className="modal-backdrop modal-overlay"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'rgba(15, 23, 42, 0.72)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2.5rem 1rem 1.25rem 1rem',
      }}
    >
      <div
        className="modal-dialog modal-card"
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: isPdf ? '960px' : '840px',
          width: '95%',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden',
          position: 'relative',
          zIndex: 100000,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.45)',
          borderRadius: '12px',
          background: '#ffffff',
          margin: 'auto',
        }}
      >
        {/* Header */}
        <div
          className="modal-header"
          style={{
            padding: '0.85rem 1.25rem',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: '#f8fafc',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: '1.2rem' }}>
              {isPdf ? '📕' : isImage ? '🖼️' : isTextOrMarkdown ? '📄' : '📁'}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h3
                style={{
                  margin: 0,
                  fontSize: '1rem',
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: '#0f172a',
                }}
                title={documentTitle}
              >
                {documentTitle}
              </h3>
              <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.1rem' }}>
                {resolvedMimeType} {initialPage ? `• Referenced Page ${initialPage}` : ''}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {contentUrl && (
              <a
                href={contentUrl}
                download={documentTitle}
                className="btn-secondary btn-xs"
                title={`Download ${documentTitle}`}
                aria-label="Download original file"
                style={{
                  textDecoration: 'none',
                  padding: '0.35rem 0.55rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                  borderRadius: '6px',
                  color: '#334155',
                }}
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
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </a>
            )}
            <button
              type="button"
              className="btn-close"
              onClick={onClose}
              aria-label="Close"
              style={{ fontSize: '1.25rem', padding: '0.2rem 0.5rem', cursor: 'pointer', lineHeight: 1 }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div
          className="modal-body"
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '1rem',
            background: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
              <div className="spin-icon" style={{ fontSize: '2rem', display: 'inline-block', marginBottom: '0.75rem' }}>
                ↻
              </div>
              <div>Retrieving authorized document preview...</div>
            </div>
          ) : error ? (
            <div className="alert-box alert-error" style={{ margin: '1.5rem' }}>
              <strong>Failed to load preview:</strong> {error}
            </div>
          ) : isPdf && contentUrl ? (
            <iframe
              src={pdfUrlWithPage}
              title={documentTitle}
              style={{
                width: '100%',
                height: '75vh',
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
              }}
            />
          ) : isImage && contentUrl ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                padding: '1rem',
                minHeight: '300px',
                background: '#f8fafc',
                borderRadius: '6px',
              }}
            >
              <img
                src={contentUrl}
                alt={documentTitle}
                style={{
                  maxWidth: '100%',
                  maxHeight: '72vh',
                  objectFit: 'contain',
                  borderRadius: '4px',
                  boxShadow: '0 2px 10px rgba(0, 0, 0, 0.08)',
                }}
              />
            </div>
          ) : isTextOrMarkdown && textContent !== null ? (
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
                padding: '1.25rem',
                fontSize: '0.85rem',
                lineHeight: 1.6,
                maxHeight: '75vh',
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                color: '#1e293b',
              }}
            >
              {textContent}
            </div>
          ) : (
            <div style={{ padding: '2.5rem', textAlign: 'center', color: '#64748b' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📄</div>
              <h4>Direct Preview Not Available for this File Type</h4>
              <p style={{ fontSize: '0.82rem', maxWidth: '420px', margin: '0.5rem auto 1.5rem auto' }}>
                This file type (<code>{resolvedMimeType}</code>) can be downloaded securely to view in your desktop application.
              </p>
              {contentUrl && (
                <a
                  href={contentUrl}
                  download={documentTitle}
                  className="btn-primary"
                  style={{ textDecoration: 'none', display: 'inline-block' }}
                >
                  Download {documentTitle}
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modalContent, document.body);
  }

  return modalContent;
});

DocumentViewerModal.displayName = 'DocumentViewerModal';
export default DocumentViewerModal;

