import React, { memo, useState, useCallback, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Portal, IngestionJob, IngestionJobDocument } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { usePortal } from '../../context/PortalContext';
import { IngestionWorkspace } from '../ingestion/IngestionWorkspace';
import { JobStatusCard } from '../JobStatusCard';
import { DocumentList } from '../DocumentList';
import { QaVerificationCard } from '../qa/QaVerificationCard';
import { KnowledgeBaseSidebar } from '../knowledge-base/KnowledgeBaseSidebar';
import { DeleteConfirmModal } from '../common/DeleteConfirmModal';

export const PortalWorkspaceLayout: React.FC = memo(() => {
  const { portalId } = useParams<{ portalId: string }>();
  const navigate = useNavigate();
  const { getClient } = useAuth();
  const {
    portals,
    selectedPortal,
    isLoadingPortals,
    portalDocuments,
    isLoadingDocuments,
    loadPortalDocuments,
    deletePortal,
    setSelectedPortal,
    loadPortals,
  } = usePortal();

  // Active portal: use selectedPortal if matches, or find by portalId param
  const portal: Portal | undefined =
    (selectedPortal?.id === portalId
      ? selectedPortal
      : portals.find(p => p.id === portalId)) ?? undefined;

  // Sync selected portal in context
  useEffect(() => {
    if (portal) {
      setSelectedPortal(portal);
      loadPortalDocuments(portal.id);
    }
  }, [portal?.id, setSelectedPortal, loadPortalDocuments]);

  // Modal & deletion state
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Active Job Tracking state
  const [currentJob, setCurrentJob] = useState<IngestionJob | null>(null);
  const [jobDocuments, setJobDocuments] = useState<IngestionJobDocument[]>([]);
  const [isPollingJob, setIsPollingJob] = useState(false);

  const pollingTimerRef = useRef<any>(null);
  const prevJobSnapshotRef = useRef<string>('');

  const stopJobPolling = useCallback(() => {
    if (pollingTimerRef.current) {
      clearInterval(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
    setIsPollingJob(false);
  }, []);

  const startJobPolling = useCallback((pId: string, jobId: string) => {
    stopJobPolling();
    setIsPollingJob(true);

    const poll = async () => {
      try {
        const client = getClient();
        const job = await client.getPortfolioJobStatus(pId, jobId);
        setCurrentJob(job);

        if (Array.isArray(job.documents)) {
          setJobDocuments(job.documents);
        }

        const snapshot = `${job.status}-${job.processedDocuments}-${job.failedDocuments}`;
        if (snapshot !== prevJobSnapshotRef.current) {
          prevJobSnapshotRef.current = snapshot;
          loadPortalDocuments(pId);
        }

        if (job.status === 'READY' || job.status === 'FAILED') {
          stopJobPolling();
          loadPortalDocuments(pId);
          loadPortals();
        }
      } catch {
        // keep polling
      }
    };

    poll();
    pollingTimerRef.current = setInterval(poll, 2500);
  }, [getClient, loadPortalDocuments, loadPortals, stopJobPolling]);

  useEffect(() => {
    return () => {
      stopJobPolling();
    };
  }, [stopJobPolling]);

  const handleJobStarted = useCallback((jobId: string) => {
    if (portalId) {
      startJobPolling(portalId, jobId);
    }
  }, [portalId, startJobPolling]);

  const handleDocumentsUpdated = useCallback(() => {
    if (portalId) {
      loadPortalDocuments(portalId);
      loadPortals();
    }
  }, [portalId, loadPortalDocuments, loadPortals]);

  const handleRetryUrl = useCallback(async (failedUrl: string) => {
    if (!portalId) return;
    try {
      const client = getClient();
      const res = await client.submitPortalUrls(portalId, [failedUrl]);
      const jobId = res.jobId || res.id;
      if (jobId) {
        startJobPolling(portalId, jobId);
      }
    } catch {
      // ignore
    }
  }, [portalId, getClient, startJobPolling]);

  const handleConfirmDelete = useCallback(async () => {
    if (!portal) return;
    setIsDeleting(true);
    try {
      await deletePortal(portal.id);
      setShowDeleteModal(false);
      stopJobPolling();
      navigate('/portals', { replace: true });
    } catch {
      // ignore
    } finally {
      setIsDeleting(false);
    }
  }, [portal, deletePortal, stopJobPolling, navigate]);

  const handleBackToPortals = useCallback(() => {
    setSelectedPortal(null);
    loadPortals();
    navigate('/portals');
  }, [setSelectedPortal, loadPortals, navigate]);

  if (!portal && (isLoadingPortals || portals.length === 0)) {
    return (
      <div className="workspace-container">
        <div className="loading-state">Loading portal workspace...</div>
      </div>
    );
  }

  if (!portal) {
    return (
      <div className="workspace-container">
        <div className="card empty-state">
          <div className="empty-icon">⚠️</div>
          <h3>Portal Not Found</h3>
          <p>The requested portal does not exist or may have been deleted.</p>
          <button
            type="button"
            className="btn-primary"
            onClick={handleBackToPortals}
          >
            ← Return to Portals
          </button>
        </div>
      </div>
    );
  }

  const displayUrl = portal.portalUrl || portal.portfolioUrl;

  return (
    <div className="workspace-container">
      {/* Workspace Header */}
      <div className="workspace-header">
        <div className="workspace-header-left">
          <button
            type="button"
            className="btn-link btn-back"
            onClick={handleBackToPortals}
          >
            ← Back to Portals
          </button>
        </div>

        <div className="workspace-header-center">
          <div className="portal-title-group portfolio-title-group">
            <h2>{portal.name}</h2>
            {displayUrl && (
              <a
                href={displayUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="portal-external-link portfolio-external-link"
              >
                🔗 {displayUrl} ↗
              </a>
            )}
          </div>
        </div>

        <div className="workspace-header-actions">
          <button
            type="button"
            className="btn-danger-outline btn-sm"
            title="Delete this portal and all associated documents"
            onClick={() => setShowDeleteModal(true)}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ marginRight: '0.4rem', verticalAlign: 'text-bottom' }}
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
            Delete Portal
          </button>
        </div>
      </div>

      {/* Two Column Layout: All components accessible in one place! */}
      <div className="workspace-columns">
        {/* Left Column: Ingestion, Active Jobs, and Question Box */}
        <div className="workspace-col-main">
          <IngestionWorkspace
            portal={portal}
            onJobStarted={handleJobStarted}
            onDocumentsUpdated={handleDocumentsUpdated}
          />

          {/* Active Ingestion Job Status */}
          {currentJob && (
            <JobStatusCard
              job={currentJob}
              statusUrl={`/v1/portals/${portal.id}/ingestion-jobs/${currentJob.id}`}
              isPolling={isPollingJob}
              onRefresh={() => startJobPolling(portal.id, currentJob.id)}
            />
          )}

          {/* Ingestion Job Document Breakdown */}
          {jobDocuments.length > 0 && (
            <DocumentList
              documents={jobDocuments}
              onRetryUrl={handleRetryUrl}
            />
          )}

          {/* Embedded Question Box - Visible when at least one document exists */}
          <QaVerificationCard
            portal={portal}
            documentCount={portalDocuments.length}
          />
        </div>

        {/* Right Column: Knowledge Base Sidebar */}
        <div className="workspace-col-side">
          <KnowledgeBaseSidebar
            documents={portalDocuments}
            isLoading={isLoadingDocuments}
            onReload={handleDocumentsUpdated}
          />
        </div>
      </div>

      <DeleteConfirmModal
        portal={showDeleteModal ? portal : null}
        isDeleting={isDeleting}
        onCancel={() => setShowDeleteModal(false)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
});

PortalWorkspaceLayout.displayName = 'PortalWorkspaceLayout';
export default PortalWorkspaceLayout;
