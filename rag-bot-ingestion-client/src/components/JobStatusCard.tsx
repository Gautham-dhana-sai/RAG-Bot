import React from 'react';
import { IngestionJob } from '../types';

interface JobStatusCardProps {
  job: IngestionJob | null;
  statusUrl: string;
  isPolling: boolean;
  onRefresh: () => void;
  onRetry?: () => void;
}

export const JobStatusCard: React.FC<JobStatusCardProps> = ({
  job,
  statusUrl,
  isPolling,
  onRefresh,
  onRetry,
}) => {
  if (!job) return null;

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'READY':
        return 'badge-ready';
      case 'PROCESSING':
        return 'badge-processing';
      case 'FAILED':
        return 'badge-failed';
      default:
        return 'badge-pending';
    }
  };

  const isReady = job.status === 'READY';
  const isFailed = job.status === 'FAILED';

  return (
    <div className="card job-status-card">
      <div className="card-header">
        <h3>Ingestion Job Status</h3>
        <div className="header-actions">
          {isPolling && <span className="polling-indicator">● Auto-polling...</span>}
          <button type="button" className="btn-secondary" onClick={onRefresh}>
            ↻ Refresh
          </button>
        </div>
      </div>

      <div className="job-details-grid">
        <div className="detail-item">
          <label>Ingestion Job:</label>
          <code>{job.id}</code>
        </div>

        <div className="detail-item">
          <label>Entity:</label>
          <code>{job.entityId}</code>
        </div>

        <div className="detail-item">
          <label>Status:</label>
          <span className={`status-badge ${getStatusBadgeClass(job.status)}`}>
            {job.status}
          </span>
        </div>

        <div className="detail-item">
          <label>Status Endpoint:</label>
          <code className="code-url">{statusUrl}</code>
        </div>

        <div className="detail-item">
          <label>Documents:</label>
          <span>
            {job.totalDocuments} submitted ({job.processedDocuments} processed, {job.failedDocuments} failed)
          </span>
        </div>
      </div>

      {isReady && (
        <div className="alert alert-success">
          ✓ <strong>Ready for Retrieval:</strong> Documents have been successfully extracted, chunked, embedded, and indexed into the vector store.
        </div>
      )}

      {isFailed && (
        <div className="alert alert-error">
          ✕ <strong>Ingestion Failed:</strong> {job.errorSummary || 'One or more documents could not be processed.'}
          {onRetry && (
            <button type="button" className="btn-retry" onClick={onRetry}>
              Retry Ingestion
            </button>
          )}
        </div>
      )}
    </div>
  );
};

