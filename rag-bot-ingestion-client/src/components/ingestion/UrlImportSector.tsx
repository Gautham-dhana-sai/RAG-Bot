import React, { memo } from 'react';

interface UrlImportSectorProps {
  urlInputs: string[];
  urlErrors?: (string | null)[];
  isSubmitting: boolean;
  onAddRow: () => void;
  onRemoveRow: (index: number) => void;
  onChangeUrl: (index: number, val: string) => void;
  onSubmit: () => void;
  onNavigateToWebsites?: () => void;
}

export const UrlImportSector: React.FC<UrlImportSectorProps> = memo(({
  urlInputs,
  urlErrors = [],
  isSubmitting,
  onAddRow,
  onRemoveRow,
  onChangeUrl,
  onSubmit,
  onNavigateToWebsites,
}) => {
  return (
    <div className="url-import-container">
      <p className="form-hint">
        Enter public URLs to PDF documents, Word documents, text notes, or photos (PNG, JPEG, WebP). URLs are securely validated against SSRF and queued for download via a dedicated worker before converging into the RAG pipeline.
      </p>

      <div className="url-inputs-list">
        {urlInputs.map((url, idx) => {
          const rowError = urlErrors[idx];
          const hasError = Boolean(rowError);
          const suggestsWebsites = Boolean(rowError && rowError.includes('Websites tab'));

          return (
            <div key={idx} className="url-input-item-group">
              <div className="url-input-row">
                <input
                  type="url"
                  className={`qa-input ${hasError ? 'input-field-has-error' : ''}`}
                  placeholder="https://example.com/document.pdf or photo.png"
                  value={url}
                  onChange={e => onChangeUrl(idx, e.target.value)}
                  disabled={isSubmitting}
                  aria-invalid={hasError}
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
              {hasError && (
                <div className="field-error-message url-input-error-msg" role="alert">
                  <span className="field-error-icon">⚠️</span>
                  <div className="field-error-content">
                    <span className="field-error-text">{rowError}</span>
                    {suggestsWebsites && onNavigateToWebsites && (
                      <button
                        type="button"
                        className="btn-inline-link"
                        onClick={onNavigateToWebsites}
                        title="Switch to Websites tab"
                      >
                        Open Websites tab ➔
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
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
