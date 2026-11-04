import React, { memo } from 'react';
import { Portal } from '../../types';

interface DeleteConfirmModalProps {
  portal: Portal | null;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = memo(({
  portal,
  isDeleting,
  onCancel,
  onConfirm,
}) => {
  if (!portal) return null;

  return (
    <div className="modal-backdrop modal-overlay" onClick={onCancel}>
      <div className="modal-dialog modal-card modal-delete" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            <span style={{ marginRight: '0.4rem' }}>⚠️</span>
            Delete Portal
          </h3>
          <button
            type="button"
            className="btn-close"
            onClick={onCancel}
            disabled={isDeleting}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          <p>
            Are you sure you want to permanently delete <strong>{portal.name}</strong>?
          </p>
          {(portal.portalUrl || portal.portfolioUrl) && (
            <p className="modal-hint">
              Portal URL: <code>{portal.portalUrl || portal.portfolioUrl}</code>
            </p>
          )}
          <div className="modal-alert-box delete-impact-card">
            <strong>This action is irreversible and will delete:</strong>
            <ul>
              <li>Portal definition and registered configuration</li>
              <li>All indexed document files and chunk metadata</li>
              <li>All vector embeddings stored in PostgreSQL database</li>
            </ul>
          </div>
          <p className="delete-subtext" style={{ marginTop: '0.75rem', fontSize: '0.82rem', color: '#dc2626' }}>
            Documents and knowledge base items for this portal cannot be recovered after deletion.
          </p>
        </div>

        <div className="modal-footer modal-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={onCancel}
            disabled={isDeleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger btn-delete-confirm"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? 'Deleting Portal...' : 'Yes, Delete Portal'}
          </button>
        </div>
      </div>
    </div>
  );
});

DeleteConfirmModal.displayName = 'DeleteConfirmModal';
