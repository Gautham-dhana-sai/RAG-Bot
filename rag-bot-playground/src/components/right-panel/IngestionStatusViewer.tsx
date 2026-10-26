import React, { useState, useEffect, useCallback } from 'react';
import { RAGApiClient } from '../../services/api-client';
import { DocumentItem, IngestionJob } from '../../types/api.types';

interface Props {
  apiClient: RAGApiClient;
  tenantId: string;
  entityId: string;
}

export const IngestionStatusViewer: React.FC<Props> = ({ apiClient, tenantId, entityId }) => {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [jobId, setJobId] = useState('');
  const [jobData, setJobData] = useState<IngestionJob | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDocuments = useCallback(async () => {
    if (!tenantId || !entityId) return;
    setIsLoading(true);
    setError(null);
    try {
      const docs = await apiClient.listDocuments(tenantId, entityId);
      setDocuments(docs);
    } catch (err: any) {
      setError(err.message || 'Failed to list documents');
    } finally {
      setIsLoading(false);
    }
  }, [apiClient, tenantId, entityId]);

  const fetchJobStatus = async () => {
    if (!jobId.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      const job = await apiClient.getJobStatus(tenantId, entityId, jobId.trim());
      setJobData(job);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch job status');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const readyCount = documents.filter(d => d.status === 'READY').length;

  return (
    <div className="ingestion-status-viewer">
      <div className="viewer-header">
        <h4>📂 Ingested Documents & Index Readiness</h4>
        <div className="header-actions">
          <button type="button" className="btn-small" onClick={fetchDocuments} disabled={isLoading}>
            ↻ Refresh Documents
          </button>
        </div>
      </div>

      <div className="readiness-summary-pill">
        <span>Indexed & Ready Chunks: <strong>{readyCount} of {documents.length} documents</strong></span>
        {readyCount > 0 ? (
          <span className="badge-ready">✓ Ready for Retrieval</span>
        ) : (
          <span className="badge-pending">⏳ No Ready Documents</span>
        )}
      </div>

      {error && <div className="diag-error">⚠️ {error}</div>}

      <div className="documents-list-mini">
        {documents.length === 0 ? (
          <p className="hint">No documents found for this entity. Upload files using the Ingestion Client.</p>
        ) : (
          <table className="mini-doc-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>MIME</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {documents.map(d => (
                <tr key={d.id}>
                  <td>{d.originalFilename}</td>
                  <td>{d.mimeType}</td>
                  <td>
                    <span className={`status-pill status-${d.status.toLowerCase()}`}>
                      {d.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="job-lookup-section">
        <h5>Poll Ingestion Job by ID</h5>
        <div className="job-lookup-row">
          <input
            type="text"
            className="text-input"
            value={jobId}
            onChange={e => setJobId(e.target.value)}
            placeholder="Paste Ingestion Job UUID..."
          />
          <button type="button" className="btn-small btn-primary" onClick={fetchJobStatus} disabled={isLoading || !jobId}>
            Check Job
          </button>
        </div>

        {jobData && (
          <div className="job-lookup-result">
            <div>Job ID: <code>{jobData.id}</code></div>
            <div>Status: <span className={`status-pill status-${jobData.status.toLowerCase()}`}>{jobData.status}</span></div>
            <div>Processed: {jobData.processedDocuments} / {jobData.totalDocuments}</div>
            {jobData.errorSummary && <div className="error-text">⚠️ {jobData.errorSummary}</div>}
          </div>
        )}
      </div>
    </div>
  );
};

