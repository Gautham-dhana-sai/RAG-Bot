import React, { memo, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';

export interface DiscoveredRouteItem {
  url: string;
  path: string;
  depth?: number;
  source?: string;
}

interface RouteSelectionModalProps {
  isOpen: boolean;
  rootUrl: string;
  routes: DiscoveredRouteItem[];
  isSubmitting?: boolean;
  onConfirm: (selectedUrls: string[]) => void;
  onCancel: () => void;
}

export const RouteSelectionModal: React.FC<RouteSelectionModalProps> = memo(({
  isOpen,
  rootUrl,
  routes,
  isSubmitting = false,
  onConfirm,
  onCancel,
}) => {
  // All eligible routes checked by default
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(() => new Set(routes.map(r => r.url)));
  const [filterQuery, setFilterQuery] = useState('');

  // Keep selectedUrls in sync when routes change
  React.useEffect(() => {
    setSelectedUrls(new Set(routes.map(r => r.url)));
    setFilterQuery('');
  }, [routes]);

  const filteredRoutes = useMemo(() => {
    if (!filterQuery.trim()) return routes;
    const q = filterQuery.toLowerCase();
    return routes.filter(r => r.path.toLowerCase().includes(q) || r.url.toLowerCase().includes(q));
  }, [routes, filterQuery]);

  if (!isOpen) return null;

  const handleToggle = (url: string) => {
    setSelectedUrls(prev => {
      const next = new Set(prev);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedUrls(new Set(routes.map(r => r.url)));
  };

  const handleDeselectAll = () => {
    setSelectedUrls(new Set());
  };

  const handleConfirm = () => {
    onConfirm(Array.from(selectedUrls));
  };

  const modalContent = (
    <div
      className="modal-backdrop modal-overlay"
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
      }}
    >
      <div
        className="modal-dialog modal-card"
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: '580px',
          width: '95%',
          maxHeight: '85vh',
          margin: 'auto',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden',
          position: 'relative',
          zIndex: 100000,
          boxShadow: 'var(--shadow-lg)',
          borderRadius: '12px',
          background: 'var(--card-bg, #ffffff)',
          border: '1px solid var(--border, #e2e8f0)',
          fontFamily: 'var(--font)',
        }}
      >
        {/* Header */}
        <div
          className="modal-header"
          style={{
            padding: '1.25rem 1.5rem',
            background: 'var(--card-bg, #ffffff)',
            borderBottom: '1px solid var(--border, #e2e8f0)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '1rem',
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3
              style={{
                margin: 0,
                fontSize: '1.2rem',
                fontWeight: 700,
                color: 'var(--text, #0f172a)',
                lineHeight: 1.3,
              }}
            >
              Select Pages to Extract
            </h3>
            <p
              style={{
                margin: '0.35rem 0 0 0',
                fontSize: '0.85rem',
                color: 'var(--text-muted, #64748b)',
                lineHeight: 1.4,
              }}
            >
              Choose which pages from{' '}
              <strong style={{ color: 'var(--text, #0f172a)', wordBreak: 'break-all' }}>
                {rootUrl}
              </strong>{' '}
              to index into this portal.
            </p>
          </div>

          <button
            type="button"
            className="btn-close"
            onClick={onCancel}
            disabled={isSubmitting}
            aria-label="Close"
            style={{
              flexShrink: 0,
              fontSize: '1.25rem',
              cursor: 'pointer',
              lineHeight: 1,
              marginTop: '0.1rem',
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div
          className="modal-body"
          style={{
            padding: '1.25rem 1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.85rem',
            flex: 1,
            overflow: 'hidden',
            background: 'var(--card-bg, #ffffff)',
          }}
        >
          {/* Search Bar */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="var(--text-muted, #64748b)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                position: 'absolute',
                left: '0.85rem',
                pointerEvents: 'none',
              }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Filter routes by path..."
              value={filterQuery}
              onChange={e => setFilterQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '0.6rem 2.2rem 0.6rem 2.4rem',
                fontSize: '0.88rem',
                fontFamily: 'var(--font)',
                color: 'var(--text, #0f172a)',
                background: 'var(--card-bg, #ffffff)',
                border: '1px solid var(--border, #e2e8f0)',
                borderRadius: '8px',
                outline: 'none',
                boxSizing: 'border-box',
                transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
              }}
              onFocus={e => {
                e.target.style.borderColor = 'var(--border-focus, #3b82f6)';
                e.target.style.boxShadow = '0 0 0 2px var(--primary-light, #eff6ff)';
              }}
              onBlur={e => {
                e.target.style.borderColor = 'var(--border, #e2e8f0)';
                e.target.style.boxShadow = 'none';
              }}
            />
            {filterQuery && (
              <button
                type="button"
                onClick={() => setFilterQuery('')}
                style={{
                  position: 'absolute',
                  right: '0.75rem',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted, #64748b)',
                  fontSize: '0.9rem',
                  padding: '0.2rem',
                  lineHeight: 1,
                }}
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          {/* Stats & Actions */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '0.85rem',
              padding: '0 0.1rem',
            }}
          >
            <span style={{ color: 'var(--text-muted, #64748b)' }}>
              <strong style={{ color: 'var(--text, #0f172a)', fontWeight: 600 }}>{selectedUrls.size}</strong>{' '}
              of {routes.length} pages selected
            </span>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={handleSelectAll}
                style={{
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: 0,
                  color: 'var(--primary, #2563eb)',
                  background: 'transparent',
                  border: 'none',
                  fontFamily: 'var(--font)',
                }}
              >
                Select all
              </button>
              <span style={{ color: 'var(--border, #e2e8f0)' }}>|</span>
              <button
                type="button"
                onClick={handleDeselectAll}
                style={{
                  fontSize: '0.82rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                  padding: 0,
                  color: 'var(--text-muted, #64748b)',
                  background: 'transparent',
                  border: 'none',
                  fontFamily: 'var(--font)',
                }}
              >
                Deselect all
              </button>
            </div>
          </div>

          {/* Scrollable Route List */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              border: '1px solid var(--border, #e2e8f0)',
              borderRadius: '8px',
              padding: '0.35rem',
              maxHeight: '340px',
              background: 'var(--bg, #f8fafc)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.25rem',
            }}
          >
            {filteredRoutes.length === 0 ? (
              <div
                style={{
                  padding: '2.5rem 1rem',
                  textAlign: 'center',
                  color: 'var(--text-muted, #64748b)',
                  fontSize: '0.88rem',
                }}
              >
                No matching routes found.
              </div>
            ) : (
              filteredRoutes.map(item => {
                const isChecked = selectedUrls.has(item.url);
                return (
                  <label
                    key={item.url}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.55rem 0.75rem',
                      borderRadius: '6px',
                      background: isChecked ? 'var(--primary-light, #eff6ff)' : 'var(--card-bg, #ffffff)',
                      border: isChecked
                        ? '1px solid #bfdbfe'
                        : '1px solid var(--border, #e2e8f0)',
                      cursor: 'pointer',
                      fontSize: '0.86rem',
                      fontFamily: 'var(--font)',
                      userSelect: 'none',
                      transition: 'all 0.12s ease',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleToggle(item.url)}
                      disabled={isSubmitting}
                      style={{
                        cursor: 'pointer',
                        width: '16px',
                        height: '16px',
                        accentColor: 'var(--primary, #2563eb)',
                        flexShrink: 0,
                        margin: 0,
                      }}
                    />
                    <span
                      style={{
                        fontSize: '0.86rem',
                        fontWeight: isChecked ? 600 : 500,
                        color: isChecked ? 'var(--primary-hover, #1d4ed8)' : 'var(--text, #0f172a)',
                        wordBreak: 'break-all',
                        flex: 1,
                        minWidth: 0,
                        lineHeight: 1.4,
                      }}
                    >
                      {item.path || '/'}
                    </span>
                    {item.source && (
                      <span
                        style={{
                          fontSize: '0.7rem',
                          padding: '0.12rem 0.45rem',
                          borderRadius: '9999px',
                          background: item.source === 'sitemap' ? 'var(--success-bg, #f0fdf4)' : '#f1f5f9',
                          color: item.source === 'sitemap' ? 'var(--success, #16a34a)' : 'var(--text-muted, #64748b)',
                          border: item.source === 'sitemap' ? '1px solid #bbf7d0' : '1px solid var(--border, #e2e8f0)',
                          flexShrink: 0,
                          textTransform: 'uppercase',
                          fontWeight: 600,
                          letterSpacing: '0.04em',
                        }}
                      >
                        {item.source}
                      </span>
                    )}
                  </label>
                );
              })
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          className="modal-footer"
          style={{
            padding: '1rem 1.5rem',
            background: 'var(--bg, #f8fafc)',
            borderTop: '1px solid var(--border, #e2e8f0)',
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: '0.75rem',
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            className="btn-secondary"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleConfirm}
            disabled={isSubmitting || selectedUrls.size === 0}
            style={{ minWidth: '150px' }}
          >
            {isSubmitting ? 'Starting...' : `Extract ${selectedUrls.size} Pages`}
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

RouteSelectionModal.displayName = 'RouteSelectionModal';

