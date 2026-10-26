import React from 'react';
import { IngestionJobDocument } from '../types';

interface DocumentListProps {
  documents: IngestionJobDocument[];
}

export const DocumentList: React.FC<DocumentListProps> = ({ documents }) => {
  if (documents.length === 0) return null;

  return (
    <div className="card documents-card">
      <h3>Documents Ingestion Breakdown</h3>
      <table className="documents-table">
        <thead>
          <tr>
            <th>Document</th>
            <th>MIME Type</th>
            <th>Size</th>
            <th>Status</th>
            <th>Details / Errors</th>
          </tr>
        </thead>
        <tbody>
          {documents.map(doc => (
            <tr key={doc.id}>
              <td className="doc-name">
                {doc.document?.originalFilename || `Doc ${doc.documentId.substring(0, 8)}`}
              </td>
              <td className="doc-mime">{doc.document?.mimeType || 'unknown'}</td>
              <td className="doc-size">
                {doc.document?.sizeBytes ? `${(doc.document.sizeBytes / 1024).toFixed(1)} KB` : '-'}
              </td>
              <td>
                <span className={`status-pill status-${doc.status.toLowerCase()}`}>
                  {doc.status}
                </span>
              </td>
              <td className="doc-error">
                {doc.errorMessage ? (
                  <span className="error-text">⚠️ {doc.errorMessage}</span>
                ) : doc.status === 'READY' ? (
                  <span className="success-text">Indexed into pgvector</span>
                ) : (
                  <span>Processing...</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

