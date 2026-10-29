import React, { memo, useState, useCallback } from 'react';
import { Portal, FileItem } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { FileUploadSector } from './FileUploadSector';
import { UrlImportSector } from './UrlImportSector';
import { validateFileOrPhotoUrlClient } from '../../utils/validators';

interface IngestionWorkspaceProps {
  portal: Portal;
  onJobStarted: (jobId: string) => void;
  onDocumentsUpdated: () => void;
}

export const IngestionWorkspace: React.FC<IngestionWorkspaceProps> = memo(({
  portal,
  onJobStarted,
  onDocumentsUpdated,
}) => {
  const { getClient } = useAuth();
  const [activeTab, setActiveTab] = useState<'files' | 'urls'>('files');

  // Direct files state
  const [selectedFiles, setSelectedFiles] = useState<FileItem[]>([]);
  const [isSubmittingFiles, setIsSubmittingFiles] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  // URL import state
  const [urlInputs, setUrlInputs] = useState<string[]>(['']);
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
  }, []);

  const handleRemoveUrlRow = useCallback((index: number) => {
    setUrlInputs(prev => (prev.length > 1 ? prev.filter((_, i) => i !== index) : ['']));
  }, []);

  const handleChangeUrl = useCallback((index: number, val: string) => {
    setUrlInputs(prev => {
      const copy = [...prev];
      copy[index] = val;
      return copy;
    });
  }, []);

  const handleSubmitUrls = useCallback(async () => {
    const cleanUrls = urlInputs.map(u => u.trim()).filter(Boolean);
    if (cleanUrls.length === 0) {
      setUrlError('Please enter at least one valid HTTP or HTTPS document/photo URL.');
      return;
    }

    for (const url of cleanUrls) {
      const check = validateFileOrPhotoUrlClient(url);
      if (!check.isValid) {
        setUrlError(check.reason || `Invalid URL: "${url}"`);
        return;
      }
    }

    setIsSubmittingUrls(true);
    setUrlError(null);

    try {
      const client = getClient();
      const res = await client.submitPortalUrls(portal.id, cleanUrls);
      const jobId = res.jobId || res.id;
      if (jobId) {
        onJobStarted(jobId);
      }
      setUrlInputs(['']);
      onDocumentsUpdated();
    } catch (err: any) {
      setUrlError(err.message || 'Failed to submit URLs. Please try again.');
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
      ) : (
        <>
          {urlError && <div className="alert-box alert-error">{urlError}</div>}
          <UrlImportSector
            urlInputs={urlInputs}
            isSubmitting={isSubmittingUrls}
            onAddRow={handleAddUrlRow}
            onRemoveRow={handleRemoveUrlRow}
            onChangeUrl={handleChangeUrl}
            onSubmit={handleSubmitUrls}
          />
        </>
      )}
    </div>
  );
});

IngestionWorkspace.displayName = 'IngestionWorkspace';

