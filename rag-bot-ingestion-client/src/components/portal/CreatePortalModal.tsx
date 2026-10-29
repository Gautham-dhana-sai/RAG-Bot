import React, { memo, useState } from 'react';
import { usePortal } from '../../context/PortalContext';

interface CreatePortalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (portalName: string) => void;
}

export const CreatePortalModal: React.FC<CreatePortalModalProps> = memo(({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { createPortal } = usePortal();
  const [url, setUrl] = useState('');
  const [customName, setCustomName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUrl = url.trim();
    if (!cleanUrl) {
      setError('Please enter a valid website or backend URL.');
      return;
    }

    try {
      new URL(cleanUrl);
    } catch {
      setError('Invalid URL syntax. Please include http:// or https://');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const created = await createPortal(cleanUrl, customName.trim() || undefined);
      setUrl('');
      setCustomName('');
      onSuccess(created.name);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to register portal. Please ensure the URL is live on the internet.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>🌐 Register New Portal</h3>
          <button type="button" className="btn-close" onClick={onClose} disabled={isSubmitting}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="portal-create-form">
          <p className="form-hint">
            Register a website or backend API. The endpoint will be verified for live connectivity and health checks before registration.
          </p>

          <div className="form-group">
            <label htmlFor="portal-url">Portal Website or Backend URL *</label>
            <input
              id="portal-url"
              type="url"
              placeholder="https://my-service.com or https://my-backend.io/api"
              value={url}
              onChange={e => setUrl(e.target.value)}
              disabled={isSubmitting}
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="portal-name">Portal Display Name (Optional)</label>
            <input
              id="portal-name"
              type="text"
              placeholder="e.g. Acme Tech Portal"
              value={customName}
              onChange={e => setCustomName(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          {error && (
            <div className="alert-box alert-error">
              {error}
            </div>
          )}

          <div className="modal-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={isSubmitting || !url.trim()}
            >
              {isSubmitting ? 'Verifying Live Endpoint...' : 'Register Portal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
});

CreatePortalModal.displayName = 'CreatePortalModal';

