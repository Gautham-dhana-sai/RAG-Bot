import React, { memo } from 'react';
import { Portal } from '../../types';

interface PortalSelectorProps {
  portals: Portal[];
  selectedPortal: Portal | null;
  isLoading: boolean;
  onSelect: (portal: Portal) => void;
  onOpenCreate: () => void;
}

export const PortalSelector: React.FC<PortalSelectorProps> = memo(({
  portals,
  selectedPortal,
  isLoading,
  onSelect,
  onOpenCreate,
}) => {
  return (
    <div className="portals-bar">
      <div className="portals-bar-header">
        <span className="portals-bar-label">Active Portals:</span>
        <button
          type="button"
          className="btn-primary btn-xs"
          onClick={onOpenCreate}
        >
          + Register New Portal
        </button>
      </div>

      <div className="portal-chips">
        {isLoading && portals.length === 0 && (
          <span className="loading-text">Loading portals...</span>
        )}

        {!isLoading && portals.length === 0 && (
          <span className="no-portals-hint">
            No portals registered yet. Click &quot;+ Register New Portal&quot; to connect a live endpoint.
          </span>
        )}

        {portals.map(portal => (
          <button
            key={portal.id}
            type="button"
            className={`portal-chip ${selectedPortal?.id === portal.id ? 'active' : ''}`}
            onClick={() => onSelect(portal)}
          >
            <span className="portal-chip-name">{portal.name}</span>
            {portal.documentCount !== undefined && (
              <span className="portal-chip-doc-count" title={`${portal.documentCount} document(s)`}>
                {portal.documentCount} docs
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
});

PortalSelector.displayName = 'PortalSelector';

