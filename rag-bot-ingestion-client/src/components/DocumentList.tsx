import React from 'react';
import { IngestionJobDocument } from '../types';

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

interface DocumentListProps {
  documents: IngestionJobDocument[];
  onRetryUrl?: (url: string) => void;
}

export const DocumentList: React.FC<DocumentListProps> = ({ documents, onRetryUrl }) => {
  if (documents.length === 0) return null;

  return (
    <div className="card documents-card">
      <h3>Documents Ingestion Breakdown</h3>
      <div className="documents-table-wrapper">
        <table className="documents-table">
          <thead>
            <tr>
              <th>Document / Source</th>
              <th>Type</th>
              <th>Stage & Status</th>
              <th>Details / Stage Info</th>
              {onRetryUrl && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {documents.map(doc => {
              const isDownloadFailure = doc.stage === 'DOWNLOAD_FAILED';
              const isIngestionFailure = doc.status === 'FAILED' && !isDownloadFailure;
              const rawName = doc.document?.originalFilename || (doc.sourceUrl ? doc.sourceUrl.split('/').pop()?.split('?')[0] : '') || `Doc ${doc.documentId.substring(0, 8)}`;
              const displayName = truncateName(rawName, 26);

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
                  <td className="doc-mime">{doc.document?.mimeType || 'auto-detect'}</td>
                <td>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', alignItems: 'flex-start' }}>
                    <span className={`status-pill status-${doc.status.toLowerCase()}`}>
                      {doc.status}
                    </span>
                    {doc.stage && doc.stage !== doc.status && (
                      <span
                        style={{
                          fontSize: '0.72rem',
                          background: doc.stage.includes('FAILED') ? '#fee2e2' : '#f1f5f9',
                          color: doc.stage.includes('FAILED') ? '#dc2626' : '#475569',
                          padding: '0.1rem 0.4rem',
                          borderRadius: '4px',
                          fontWeight: 500,
                        }}
                      >
                        {doc.stage.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                </td>
                <td className="doc-error">
                  {isDownloadFailure ? (
                    <span className="error-text">⚠️ Download Error: {doc.errorMessage}</span>
                  ) : isIngestionFailure ? (
                    <span className="error-text">⚠️ Ingestion Error: {doc.errorMessage}</span>
                  ) : doc.status === 'READY' ? (
                    <span className="success-text">✓ Grounded & Indexed in pgvector</span>
                  ) : doc.stage === 'UPLOADED_TO_S3' ? (
                    <span style={{ color: '#0284c7' }}>☁️ Stored in S3, queuing ingestion...</span>
                  ) : doc.stage === 'DOWNLOADING' ? (
                    <span style={{ color: '#d97706' }}>⬇️ Securely downloading from URL...</span>
                  ) : (
                    <span>Processing pipeline...</span>
                  )}
                </td>
                {onRetryUrl && (
                  <td>
                    {(isDownloadFailure || isIngestionFailure) && doc.sourceUrl && (
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

