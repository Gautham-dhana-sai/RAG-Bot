import React, { memo } from 'react';
import { CrawlJob } from '../../types';

interface RefetchConfirmModalProps {
  crawl: CrawlJob | null;
  isRefetching: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const RefetchConfirmModal: React.FC<RefetchConfirmModalProps> = memo(({
  crawl,
  isRefetching,
  onCancel,
  onConfirm,
}) => {
  if (!crawl) return null;

  return (
    <div className="modal-backdrop modal-overlay" onClick={onCancel}>
      <div className="modal-dialog modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
        <div className="modal-header">
          <h3>
            <span style={{ marginRight: '0.4rem' }}>🔄</span>
            Refetch Website Content
          </h3>
          <button
            type="button"
            className="btn-close"
            onClick={onCancel}
            disabled={isRefetching}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          <p style={{ marginBottom: '0.75rem' }}>
            Are you sure you want to refetch <strong>{crawl.rootUrl}</strong>?
          </p>

          <div
            className="modal-alert-box"
            style={{
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '6px',
              padding: '0.75rem 1rem',
              fontSize: '0.84rem',
              color: '#166534',
              marginBottom: '0.75rem',
            }}
          >
            <strong>Zero-Downtime Guarantee:</strong>
            <p style={{ margin: '0.35rem 0 0 0' }}>
              Your existing indexed documents will remain <strong>active and retrievable</strong> in AI chat queries throughout the refetch process.
            </p>
          </div>

          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              padding: '0.75rem 1rem',
              fontSize: '0.82rem',
              color: '#475569',
            }}
          >
            <strong>What happens during refetch:</strong>
            <ul style={{ margin: '0.35rem 0 0 1.25rem', padding: 0 }}>
              <li>Discovers newly added routes within the site boundary.</li>
              <li>Compares content hashes of previously indexed pages.</li>
              <li>Unchanged pages are skipped without redundant re-embedding.</li>
              <li>Modified pages create a new version and atomically update active search embeddings.</li>
            </ul>
          </div>
        </div>

        <div className="modal-footer modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem' }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={onCancel}
            disabled={isRefetching}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onConfirm}
            disabled={isRefetching}
            style={{ background: '#2563eb', color: '#ffffff' }}
          >
            {isRefetching ? 'Starting Refetch...' : 'Confirm Refetch'}
          </button>
        </div>
      </div>
    </div>
  );
});

RefetchConfirmModal.displayName = 'RefetchConfirmModal';
export default RefetchConfirmModal;

