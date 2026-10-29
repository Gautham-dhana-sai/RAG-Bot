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
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-card modal-delete" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="delete-modal-title">
            <span className="warning-icon">⚠️</span>
            <h3>Delete Portal</h3>
          </div>
          <button type="button" className="btn-close" onClick={onCancel} disabled={isDeleting}>✕</button>
        </div>

        <div className="modal-body">
          <p>
            Are you sure you want to delete <strong>{portal.name}</strong>?
          </p>
          <div className="delete-impact-card">
            <p><strong>This irreversible action will permanently delete:</strong></p>
            <ul>
              <li>The portal definition and target configuration</li>
              <li>All indexed document files and chunk metadata</li>
              <li>All vector embeddings stored in PostgreSQL</li>
            </ul>
          </div>
          <p className="delete-subtext">
            Documents and knowledge base items for this portal cannot be recovered after deletion.
          </p>
        </div>

        <div className="modal-actions">
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
            {isDeleting ? 'Deleting...' : 'Yes, Delete Portal'}
          </button>
        </div>
      </div>
    </div>
  );
});

DeleteConfirmModal.displayName = 'DeleteConfirmModal';

