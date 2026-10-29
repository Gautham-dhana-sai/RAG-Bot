import React, { memo } from 'react';
import { Portal } from '../../types';

interface PortalHeaderProps {
  portal: Portal;
  documentCount: number;
  onDeleteRequest: (portal: Portal) => void;
}

export const PortalHeader: React.FC<PortalHeaderProps> = memo(({
  portal,
  documentCount,
  onDeleteRequest,
}) => {
  const portalUrl = portal.portalUrl || portal.portfolioUrl;

  return (
    <div className="card portal-detail-card">
      <div className="portal-header-row">
        <div className="portal-info-block">
          <div className="portal-title-line">
            <h3>{portal.name}</h3>
            {portal.isPublic && (
              <span className="badge badge-public">Public Portal</span>
            )}
            <span className="badge badge-doc-count">
              {documentCount} document{documentCount !== 1 ? 's' : ''} indexed
            </span>
          </div>

          {portalUrl && (
            <div className="portal-url-line">
              <span className="portal-url-label">Endpoint:</span>
              <a
                href={portalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="portal-url-link"
                title="Open portal destination in a new tab"
              >
                {portalUrl} ↗
              </a>
            </div>
          )}
        </div>

        <button
          type="button"
          className="btn-danger-outline btn-sm btn-delete-portal"
          onClick={() => onDeleteRequest(portal)}
          title="Delete portal and all indexed documents"
        >
          🗑️ Delete Portal
        </button>
      </div>
    </div>
  );
});

PortalHeader.displayName = 'PortalHeader';

