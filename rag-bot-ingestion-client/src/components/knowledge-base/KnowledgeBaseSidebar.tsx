import React, { memo } from 'react';
import { DocumentInfo } from '../../types';
import { formatDisplayName, formatBytes } from '../../utils/formatters';

interface KnowledgeBaseSidebarProps {
  documents: DocumentInfo[];
  isLoading: boolean;
  onReload: () => void;
}

export const KnowledgeBaseSidebar: React.FC<KnowledgeBaseSidebarProps> = memo(({
  documents,
  isLoading,
  onReload,
}) => {
  return (
    <div className="card side-docs-card">
      <div className="side-docs-header">
        <h3>Portal Knowledge Base</h3>
        <button
          type="button"
          className="btn-secondary btn-xs"
          onClick={onReload}
          disabled={isLoading}
          title="Refresh indexed files"
        >
          ↻
        </button>
      </div>
      <p className="form-hint">
        {documents.length} document(s) indexed for this portal.
      </p>

      {isLoading ? (
        <div className="loading-state">Loading indexed files...</div>
      ) : documents.length === 0 ? (
        <div className="empty-state-small">
          No documents indexed yet. Upload files to start.
        </div>
      ) : (
        <ul className="side-doc-list">
          {documents.map(doc => {
            const formattedSize = formatBytes(doc.sizeBytes);
            return (
              <li key={doc.id} className="side-doc-item">
                <div className="side-doc-info">
                  <span className="side-doc-name" title={doc.originalFilename}>
                    {formatDisplayName(doc.originalFilename, 26)}
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
        </ul>
      )}
    </div>
  );
});

KnowledgeBaseSidebar.displayName = 'KnowledgeBaseSidebar';
export default KnowledgeBaseSidebar;
