import React, { memo, useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { usePortal } from '../../context/PortalContext';
import { Portal } from '../../types';
import { capitalizeName } from '../../utils/formatters';
import { DeleteConfirmModal } from '../common/DeleteConfirmModal';

export const PortalsDashboardView: React.FC = memo(() => {
  const navigate = useNavigate();
  const { userEmail, userName } = useAuth();
  const {
    portals,
    isLoadingPortals,
    loadPortals,
    createPortal,
    deletePortal,
    setSelectedPortal,
    loadPortalDocuments,
  } = usePortal();

  // Reset selected portal on dashboard view mount
  useEffect(() => {
    setSelectedPortal(null);
  }, [setSelectedPortal]);

  const [newPortalUrl, setNewPortalUrl] = useState('');
  const [newPortalName, setNewPortalName] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Deletion state
  const [portalToDelete, setPortalToDelete] = useState<Portal | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleOpenPortal = useCallback((portal: Portal) => {
    setSelectedPortal(portal);
    loadPortalDocuments(portal.id);
    navigate(`/portals/${portal.id}`);
  }, [setSelectedPortal, loadPortalDocuments, navigate]);

  const handleRegisterPortal = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUrl = newPortalUrl.trim();
    if (!cleanUrl) {
      setRegisterError('Please enter a valid portal URL or website.');
      return;
    }

    try {
      new URL(cleanUrl);
    } catch {
      setRegisterError('Invalid URL syntax. Please include http:// or https://');
      return;
    }

    setIsRegistering(true);
    setRegisterError(null);

    try {
      const created = await createPortal(cleanUrl, newPortalName.trim() || undefined);
      setNewPortalUrl('');
      setNewPortalName('');
      setSuccessMessage(`✓ Portal "${created.name}" registered and verified successfully.`);
      setTimeout(() => setSuccessMessage(null), 4000);
      setSelectedPortal(created);
      loadPortalDocuments(created.id);
      navigate(`/portals/${created.id}`);
    } catch (err: any) {
      setRegisterError(err.message || 'Failed to register portal. Ensure the URL is live on the internet.');
    } finally {
      setIsRegistering(false);
    }
  };

  const handleConfirmDelete = useCallback(async () => {
    if (!portalToDelete) return;
    setIsDeleting(true);
    try {
      const name = portalToDelete.name;
      await deletePortal(portalToDelete.id);
      setPortalToDelete(null);
      setSuccessMessage(`✓ Portal "${name}" was successfully deleted.`);
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: any) {
      setRegisterError(err.message || 'Failed to delete portal.');
    } finally {
      setIsDeleting(false);
    }
  }, [portalToDelete, deletePortal]);

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <div>
          <h2>Welcome, {capitalizeName(userName || userEmail.split('@')[0])}</h2>
          <p className="subtitle">
            Manage your portals & knowledge bases, or register a new portal or website by URL.
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={loadPortals}
          disabled={isLoadingPortals}
          title="Refresh portals list"
        >
          {isLoadingPortals ? 'Refreshing...' : '↻ Refresh Portals'}
        </button>
      </div>

      {successMessage && (
        <div className="alert-box alert-success">
          {successMessage}
        </div>
      )}

      {/* Add Portal Card */}
      <div className="card add-portal-card add-portfolio-card">
        <h3>🌐 Register New Portal</h3>
        <p className="form-hint">
          Provide any public documentation site, portfolio, or knowledge base URL. The URL will be verified live before registration.
        </p>

        {registerError && (
          <div className="alert-box alert-error">
            ✕ {registerError}
          </div>
        )}

        <form onSubmit={handleRegisterPortal} className="add-portal-form add-portfolio-form">
          <div className="form-row">
            <div className="form-group flex-2">
              <label htmlFor="dashboard-portal-url">Portal URL / Website *</label>
              <input
                id="dashboard-portal-url"
                type="text"
                required
                placeholder="https://docs.mycompany.com"
                value={newPortalUrl}
                onChange={e => setNewPortalUrl(e.target.value)}
                disabled={isRegistering}
              />
            </div>
            <div className="form-group flex-1">
              <label htmlFor="dashboard-portal-name">Portal Name (Optional)</label>
              <input
                id="dashboard-portal-name"
                type="text"
                placeholder="e.g., Acme Cloud Platform Docs"
                value={newPortalName}
                onChange={e => setNewPortalName(e.target.value)}
                disabled={isRegistering}
              />
            </div>
            <div className="form-group btn-align">
              <button
                type="submit"
                className="btn-primary"
                disabled={isRegistering || !newPortalUrl.trim()}
              >
                {isRegistering ? 'Verifying & Registering...' : 'Register Portal'}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Portals Section */}
      <div className="portals-section">
        <h3>Your Knowledge Portals ({portals.length})</h3>

        {isLoadingPortals && portals.length === 0 ? (
          <div className="loading-state">Loading your portals...</div>
        ) : portals.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🌐</div>
            <p>No portals registered yet. Enter a website or documentation URL above to start.</p>
          </div>
        ) : (
          <div className="portals-grid portfolios-grid">
            {portals.map(p => {
              const displayUrl = p.portalUrl || p.portfolioUrl;
              return (
                <div
                  key={p.id}
                  className="portal-card portfolio-card clickable-portal-card"
                  onClick={() => handleOpenPortal(p)}
                >
                  <div className="portal-card-header portfolio-card-header">
                    <h4>{p.name}</h4>
                    <span className="doc-count-badge">
                      📄 {p.documentCount} {p.documentCount === 1 ? 'doc' : 'docs'}
                    </span>
                  </div>

                  {displayUrl ? (
                    <div className="portal-url-link portfolio-url-link">
                      <a
                        href={displayUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                      >
                        🔗 {displayUrl}
                      </a>
                    </div>
                  ) : (
                    <div className="portal-url-empty portfolio-url-empty">Default Portal</div>
                  )}

                  <div className="portal-card-footer portfolio-card-footer">
                    <span className="portal-date portfolio-date">
                      Created {new Date(p.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                    <div className="portal-card-actions portfolio-card-actions" onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        className="btn-card-delete-icon"
                        title="Delete portal"
                        aria-label="Delete portal"
                        onClick={() => setPortalToDelete(p)}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          width="18"
                          height="18"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        onClick={() => handleOpenPortal(p)}
                      >
                        Open Workspace →
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <DeleteConfirmModal
        portal={portalToDelete}
        isDeleting={isDeleting}
        onCancel={() => setPortalToDelete(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
});

PortalsDashboardView.displayName = 'PortalsDashboardView';
export default PortalsDashboardView;

