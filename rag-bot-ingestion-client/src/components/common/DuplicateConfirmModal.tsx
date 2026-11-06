import React, { memo } from 'react';
import { createPortal } from 'react-dom';

export interface DuplicateConfirmModalProps {
  isOpen: boolean;
  sourceName: string;
  sourceType: 'file' | 'website';
  title?: string;
  description?: string;
  confirmLabel?: string;
  confirmButtonClass?: string;
  isProcessing?: boolean;
  onUpdateExisting: () => void;
  onKeepExisting: () => void;
  onCancel: () => void;
}

export const DuplicateConfirmModal: React.FC<DuplicateConfirmModalProps> = memo(({
  isOpen,
  sourceName,
  sourceType,
  title,
  description,
  confirmLabel,
  confirmButtonClass = 'btn-danger',
  isProcessing = false,
  onUpdateExisting,
  onKeepExisting,
  onCancel,
}) => {
  if (!isOpen) return null;

  const defaultTitle = sourceType === 'website' ? 'Website Already Exists' : 'File Already Exists';
  const defaultDescription = sourceType === 'website'
    ? 'This website is already present in your Knowledge Base. Would you like to refetch and update it?'
    : 'This file already exists in your Knowledge Base. Would you like to replace it?';
  const defaultConfirmLabel = sourceType === 'website' ? 'Refetch & Update' : 'Replace';

  const modalContent = (
    <div
      className="modal-backdrop modal-overlay"
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'rgba(15, 23, 42, 0.72)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
      }}
    >
      <div
        className="modal-dialog modal-card modal-confirm"
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: '520px',
          width: '95%',
          margin: 'auto',
          position: 'relative',
          zIndex: 100000,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.45)',
          borderRadius: '12px',
          background: '#ffffff',
          overflow: 'hidden',
        }}
      >
        <div className="modal-header" style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fffbeb' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, fontSize: '1.05rem', color: '#b45309' }}>
            <span style={{ fontSize: '1.2rem' }}>⚠️</span>
            {title || defaultTitle}
          </h3>
          <button
            type="button"
            className="btn-close"
            onClick={onCancel}
            disabled={isProcessing}
            style={{ fontSize: '1.25rem', padding: '0.2rem 0.5rem', cursor: 'pointer', lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        <div className="modal-body" style={{ padding: '1.25rem' }}>
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              padding: '0.75rem 1rem',
              marginBottom: '1rem',
              wordBreak: 'break-all',
              fontWeight: 600,
              fontSize: '0.88rem',
              color: '#1e293b',
              maxHeight: '120px',
              overflowY: 'auto',
            }}
          >
            {sourceType === 'website' ? '🌐 ' : '📄 '}
            {sourceName}
          </div>

          <p style={{ margin: '0 0 0.5rem 0', color: '#475569', fontSize: '0.88rem', lineHeight: 1.5 }}>
            {description || defaultDescription}
          </p>
        </div>

        <div className="modal-footer" style={{ padding: '0.85rem 1.25rem', background: '#f8fafc', borderTop: '1px solid #e2e8f0', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={onCancel}
            disabled={isProcessing}
            style={{ padding: '0.45rem 0.9rem', fontSize: '0.82rem' }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={onKeepExisting}
            disabled={isProcessing}
            style={{ padding: '0.45rem 0.9rem', fontSize: '0.82rem' }}
          >
            Keep Existing
          </button>
          <button
            type="button"
            className={confirmButtonClass || 'btn-danger'}
            onClick={onUpdateExisting}
            disabled={isProcessing}
            style={{ minWidth: '130px', padding: '0.45rem 1rem', fontSize: '0.82rem', fontWeight: 600 }}
          >
            {isProcessing ? 'Processing...' : (confirmLabel || defaultConfirmLabel)}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modalContent, document.body);
  }

  return modalContent;
});

DuplicateConfirmModal.displayName = 'DuplicateConfirmModal';

