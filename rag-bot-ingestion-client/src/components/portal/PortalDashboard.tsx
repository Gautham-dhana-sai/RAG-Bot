import React, { memo, useState, useCallback, useRef, useEffect } from 'react';
import { Portal, IngestionJob, IngestionJobDocument } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { usePortal } from '../../context/PortalContext';
import { PortalSelector } from './PortalSelector';
import { PortalHeader } from './PortalHeader';
import { CreatePortalModal } from './CreatePortalModal';
import { DeleteConfirmModal } from '../common/DeleteConfirmModal';
import { IngestionWorkspace } from '../ingestion/IngestionWorkspace';
import { JobStatusCard } from '../JobStatusCard';
import { DocumentList } from '../DocumentList';
import { QaVerificationCard } from '../qa/QaVerificationCard';
import { KnowledgeBaseSidebar } from '../knowledge-base/KnowledgeBaseSidebar';

export const PortalDashboard: React.FC = memo(() => {
  const { getClient } = useAuth();
  const {
    portals,
    selectedPortal,
    setSelectedPortal,
    portalDocuments,
    isLoadingPortals,
    isLoadingDocuments,
    loadPortalDocuments,
    deletePortal,
  } = usePortal();

  // Modal states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [portalToDelete, setPortalToDelete] = useState<Portal | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);

  // Active Job Tracking state
  const [currentJob, setCurrentJob] = useState<IngestionJob | null>(null);
  const [jobDocuments, setJobDocuments] = useState<IngestionJobDocument[]>([]);
  const [isPollingJob, setIsPollingJob] = useState(false);

  const pollingTimerRef = useRef<any>(null);
  const prevJobSnapshotRef = useRef<string>('');

  // Polling logic
  const stopJobPolling = useCallback(() => {
    if (pollingTimerRef.current) {
      clearInterval(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
    setIsPollingJob(false);
  }, []);

  const startJobPolling = useCallback((portalId: string, jobId: string) => {
    stopJobPolling();
    setIsPollingJob(true);

    const poll = async () => {
      try {
        const client = getClient();
        const job = await client.getPortfolioJobStatus(portalId, jobId);
        setCurrentJob(job);

        if (Array.isArray(job.documents)) {
          setJobDocuments(job.documents);
        }

        const snapshot = `${job.status}-${job.processedDocuments}-${job.failedDocuments}`;
        if (snapshot !== prevJobSnapshotRef.current) {
          prevJobSnapshotRef.current = snapshot;
          loadPortalDocuments(portalId);
        }

        if (job.status === 'READY' || job.status === 'FAILED') {
          stopJobPolling();
          loadPortalDocuments(portalId);
        }
      } catch {
        // keep polling
      }
    };

    poll();
    pollingTimerRef.current = setInterval(poll, 2500);
  }, [getClient, loadPortalDocuments, stopJobPolling]);

  useEffect(() => {
    return () => {
      stopJobPolling();
    };
  }, [stopJobPolling]);

  // Handlers
  const handlePortalSelected = useCallback((portal: Portal) => {
    setSelectedPortal(portal);
    setCurrentJob(null);
    setJobDocuments([]);
    stopJobPolling();
  }, [setSelectedPortal, stopJobPolling]);

  const handleOpenCreate = useCallback(() => {
    setIsCreateOpen(true);
  }, []);

  const handleCloseCreate = useCallback(() => {
    setIsCreateOpen(false);
  }, []);

  const handleCreateSuccess = useCallback((portalName: string) => {
    setActionSuccessMessage(`✓ Portal "${portalName}" registered and verified successfully.`);
    setTimeout(() => setActionSuccessMessage(null), 4000);
  }, []);

  const handleDeleteRequest = useCallback((portal: Portal) => {
    setPortalToDelete(portal);
  }, []);

  const handleCancelDelete = useCallback(() => {
    setPortalToDelete(null);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!portalToDelete) return;
    setIsDeleting(true);
    try {
      const deletedName = portalToDelete.name;
      await deletePortal(portalToDelete.id);
      setPortalToDelete(null);
      setCurrentJob(null);
      setJobDocuments([]);
      stopJobPolling();
      setActionSuccessMessage(`✓ Portal "${deletedName}" was successfully deleted.`);
      setTimeout(() => setActionSuccessMessage(null), 4000);
    } catch {
      // ignore
    } finally {
      setIsDeleting(false);
    }
  }, [portalToDelete, deletePortal, stopJobPolling]);

  const handleJobStarted = useCallback((jobId: string) => {
    if (selectedPortal) {
      startJobPolling(selectedPortal.id, jobId);
    }
  }, [selectedPortal, startJobPolling]);

  const handleDocumentsUpdated = useCallback(() => {
    if (selectedPortal) {
      loadPortalDocuments(selectedPortal.id);
    }
  }, [selectedPortal, loadPortalDocuments]);

  const handleRetryUrl = useCallback(async (failedUrl: string) => {
    if (!selectedPortal) return;
    try {
      const client = getClient();
      const res = await client.submitPortalUrls(selectedPortal.id, [failedUrl]);
      const jobId = res.jobId || res.id;
      if (jobId) {
        startJobPolling(selectedPortal.id, jobId);
      }
    } catch {
      // ignore
    }
  }, [selectedPortal, getClient, startJobPolling]);

  return (
    <div className="portal-dashboard">
      <PortalSelector
        portals={portals}
        selectedPortal={selectedPortal}
        isLoading={isLoadingPortals}
        onSelect={handlePortalSelected}
        onOpenCreate={handleOpenCreate}
      />

      {actionSuccessMessage && (
        <div className="alert-box alert-success dashboard-alert">
          {actionSuccessMessage}
        </div>
      )}

      {selectedPortal ? (
        <div className="portal-workspace-layout">
          {/* Main Left/Center Column */}
          <div className="workspace-col-main">
            <PortalHeader
              portal={selectedPortal}
              documentCount={portalDocuments.length}
              onDeleteRequest={handleDeleteRequest}
            />

            <IngestionWorkspace
              portal={selectedPortal}
              onJobStarted={handleJobStarted}
              onDocumentsUpdated={handleDocumentsUpdated}
            />

            {/* Active Ingestion Job Status */}
            {currentJob && (
              <JobStatusCard
                job={currentJob}
                statusUrl={`/v1/portals/${selectedPortal.id}/ingestion-jobs/${currentJob.id}`}
                isPolling={isPollingJob}
                onRefresh={() => startJobPolling(selectedPortal.id, currentJob.id)}
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
              portal={selectedPortal}
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
      ) : (
        <div className="no-portal-selected-card">
          <div className="empty-icon">🌐</div>
          <h3>No Portal Selected</h3>
          <p>Select a portal from the bar above or click below to register your first portal.</p>
          <button
            type="button"
            className="btn-primary"
            onClick={handleOpenCreate}
          >
            + Register New Portal
          </button>
        </div>
      )}

      {/* Reusable Modals */}
      <CreatePortalModal
        isOpen={isCreateOpen}
        onClose={handleCloseCreate}
        onSuccess={handleCreateSuccess}
      />

      <DeleteConfirmModal
        portal={portalToDelete}
        isDeleting={isDeleting}
        onCancel={handleCancelDelete}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
});

PortalDashboard.displayName = 'PortalDashboard';

