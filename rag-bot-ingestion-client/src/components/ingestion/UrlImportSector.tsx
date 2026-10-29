import React, { memo } from 'react';

interface UrlImportSectorProps {
  urlInputs: string[];
  isSubmitting: boolean;
  onAddRow: () => void;
  onRemoveRow: (index: number) => void;
  onChangeUrl: (index: number, val: string) => void;
  onSubmit: () => void;
}

export const UrlImportSector: React.FC<UrlImportSectorProps> = memo(({
  urlInputs,
  isSubmitting,
  onAddRow,
  onRemoveRow,
  onChangeUrl,
  onSubmit,
}) => {
  return (
    <div className="url-import-container">
      <p className="form-hint">
        Enter public URLs to PDF documents, Word documents, text notes, or photos (PNG, JPEG, WebP). URLs are securely validated against SSRF and queued for download via a dedicated worker before converging into the RAG pipeline.
      </p>

      <div className="url-inputs-list">
        {urlInputs.map((url, idx) => (
          <div key={idx} className="url-input-row">
            <input
              type="url"
              className="qa-input"
              placeholder="https://example.com/document.pdf or photo.png"
              value={url}
              onChange={e => onChangeUrl(idx, e.target.value)}
              disabled={isSubmitting}
            />
            {urlInputs.length > 1 && (
              <button
                type="button"
                className="btn-card-delete-icon"
                title="Remove URL"
                onClick={() => onRemoveRow(idx)}
                disabled={isSubmitting}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="url-actions-row">
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={onAddRow}
          disabled={isSubmitting || urlInputs.length >= 20}
        >
          + Add Another URL
        </button>
      </div>

      <div className="submit-action-bar">
        <button
          type="button"
          className="btn-primary btn-lg"
          onClick={onSubmit}
          disabled={isSubmitting || urlInputs.every(u => !u.trim())}
        >
          {isSubmitting ? 'Submitting URLs...' : `Import & Ingest ${urlInputs.filter(u => u.trim()).length || ''} URL(s)`}
        </button>
      </div>
    </div>
  );
});

UrlImportSector.displayName = 'UrlImportSector';

