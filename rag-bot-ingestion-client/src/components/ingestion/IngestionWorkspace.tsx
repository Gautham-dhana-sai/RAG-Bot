import React, { memo, useState, useCallback } from 'react';
import { Portal, FileItem, DocumentInfo, IngestionJobDocument } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { FileUploadSector } from './FileUploadSector';
import { UrlImportSector } from './UrlImportSector';
import { WebsiteImportSector } from './WebsiteImportSector';
import { validateFileOrPhotoUrlClient } from '../../utils/validators';

interface IngestionWorkspaceProps {
  portal: Portal;
  onJobStarted: (jobId: string) => void;
  onDocumentsUpdated: () => void;
  portalDocuments?: DocumentInfo[];
  jobDocuments?: IngestionJobDocument[];
  onRetryUrl?: (url: string) => void;
}

export const IngestionWorkspace: React.FC<IngestionWorkspaceProps> = memo(({
  portal,
  onJobStarted,
  onDocumentsUpdated,
  portalDocuments = [],
  jobDocuments = [],
  onRetryUrl,
}) => {
  const { getClient } = useAuth();
  const [activeTab, setActiveTab] = useState<'files' | 'urls' | 'websites'>('files');

  // Direct files state
  const [selectedFiles, setSelectedFiles] = useState<FileItem[]>([]);
  const [isSubmittingFiles, setIsSubmittingFiles] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  // URL import state
  const [urlInputs, setUrlInputs] = useState<string[]>(['']);
  const [urlErrors, setUrlErrors] = useState<(string | null)[]>([]);
  const [isSubmittingUrls, setIsSubmittingUrls] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  // File Handlers
  const handleFilesSelected = useCallback((files: FileItem[]) => {
    setSelectedFiles(files);
    setFileError(null);
  }, []);

  const handleRemoveFile = useCallback((index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleSubmitFiles = useCallback(async () => {
    if (selectedFiles.length === 0) return;
    setIsSubmittingFiles(true);
    setFileError(null);

    try {
      const client = getClient();
      const rawFiles = selectedFiles.map(f => f.file);
      const res = await client.submitPortalFiles(portal.id, rawFiles);
      const jobId = res.jobId || res.id;
      if (jobId) {
        onJobStarted(jobId);
      }
      setSelectedFiles([]);
      onDocumentsUpdated();
    } catch (err: any) {
      setFileError(err.message || 'File upload failed. Please try again.');
    } finally {
      setIsSubmittingFiles(false);
    }
  }, [selectedFiles, getClient, portal.id, onJobStarted, onDocumentsUpdated]);

  // URL Handlers
  const handleAddUrlRow = useCallback(() => {
    setUrlInputs(prev => [...prev, '']);
    setUrlErrors(prev => [...prev, null]);
  }, []);

  const handleRemoveUrlRow = useCallback((index: number) => {
    setUrlInputs(prev => (prev.length > 1 ? prev.filter((_, i) => i !== index) : ['']));
    setUrlErrors(prev => (prev.length > 1 ? prev.filter((_, i) => i !== index) : [null]));
  }, []);

  const handleChangeUrl = useCallback((index: number, val: string) => {
    setUrlInputs(prev => {
      const copy = [...prev];
      copy[index] = val;
      return copy;
    });
    setUrlErrors(prev => {
      if (!prev[index]) return prev;
      const copy = [...prev];
      copy[index] = null;
      return copy;
    });
    setUrlError(null);
  }, []);

  const handleSubmitUrls = useCallback(async () => {
    // 1. Validate all rows and map error messages to specific input indices
    const rowErrors: (string | null)[] = urlInputs.map((val) => {
      const trimmed = val.trim();
      if (!trimmed) {
        return urlInputs.length === 1
          ? 'Please enter a valid document or photo URL.'
          : 'Please enter a valid URL or remove this empty field.';
      }
      const check = validateFileOrPhotoUrlClient(trimmed);
      if (!check.isValid) {
        return check.reason || 'Invalid URL.';
      }
      return null;
    });

    const hasAnyErrors = rowErrors.some(err => err !== null);
    if (hasAnyErrors) {
      setUrlErrors(rowErrors);
      setUrlError(null);
      return;
    }

    const cleanUrls = urlInputs.map(u => u.trim()).filter(Boolean);
    if (cleanUrls.length === 0) {
      setUrlErrors(['Please enter at least one valid HTTP or HTTPS document/photo URL.']);
      return;
    }

    setIsSubmittingUrls(true);
    setUrlError(null);
    setUrlErrors([]);

    try {
      const client = getClient();
      const res = await client.submitPortalUrls(portal.id, cleanUrls);
      const jobId = res.jobId || res.id;
      if (jobId) {
        onJobStarted(jobId);
      }
      setUrlInputs(['']);
      setUrlErrors([]);
      onDocumentsUpdated();
    } catch (err: any) {
      const errMsg = err.message || 'Failed to submit URLs. Please try again.';
      // Check if error message targets a specific rejected URL
      const rejectedMatch = errMsg.match(/Rejected URL "([^"]+)":\s*(.+)/);
      if (rejectedMatch) {
        const [, badUrl, reason] = rejectedMatch;
        const targetIdx = urlInputs.findIndex(u => u.trim() === badUrl.trim());
        if (targetIdx !== -1) {
          const updated = new Array(urlInputs.length).fill(null);
          updated[targetIdx] = reason;
          setUrlErrors(updated);
          return;
        }
      }
      setUrlError(errMsg);
    } finally {
      setIsSubmittingUrls(false);
    }
  }, [urlInputs, getClient, portal.id, onJobStarted, onDocumentsUpdated]);

  return (
    <div className="card">
      <div className="ingestion-tabs-header">
        <button
          type="button"
          className={`tab-btn ${activeTab === 'files' ? 'active' : ''}`}
          onClick={() => setActiveTab('files')}
        >
          📁 Direct File Upload
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'urls' ? 'active' : ''}`}
          onClick={() => setActiveTab('urls')}
        >
          🔗 Import from URLs & Photos
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'websites' ? 'active' : ''}`}
          onClick={() => setActiveTab('websites')}
        >
          🌐 Websites
        </button>
      </div>

      {activeTab === 'files' ? (
        <>
          {fileError && <div className="alert-box alert-error">{fileError}</div>}
          <FileUploadSector
            selectedFiles={selectedFiles}
            isSubmitting={isSubmittingFiles}
            onFilesSelected={handleFilesSelected}
            onRemoveFile={handleRemoveFile}
            onSubmit={handleSubmitFiles}
          />
        </>
      ) : activeTab === 'urls' ? (
        <>
          {urlError && <div className="alert-box alert-error">{urlError}</div>}
          <UrlImportSector
            urlInputs={urlInputs}
            urlErrors={urlErrors}
            isSubmitting={isSubmittingUrls}
            onAddRow={handleAddUrlRow}
            onRemoveRow={handleRemoveUrlRow}
            onChangeUrl={handleChangeUrl}
            onSubmit={handleSubmitUrls}
            onNavigateToWebsites={() => setActiveTab('websites')}
          />
        </>
      ) : (
        <WebsiteImportSector
          portal={portal}
          portalDocuments={portalDocuments}
          jobDocuments={jobDocuments}
          onRetryUrl={onRetryUrl}
          onJobStarted={onJobStarted}
          onDocumentsUpdated={onDocumentsUpdated}
        />
      )}
    </div>
  );
});

IngestionWorkspace.displayName = 'IngestionWorkspace';
