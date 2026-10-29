import React, { memo } from 'react';
import { FileItem } from '../../types';
import { FileDropZone } from '../FileDropZone';

interface FileUploadSectorProps {
  selectedFiles: FileItem[];
  isSubmitting: boolean;
  onFilesSelected: (files: FileItem[]) => void;
  onRemoveFile?: (index: number) => void;
  onSubmit: () => void;
}

export const FileUploadSector: React.FC<FileUploadSectorProps> = memo(({
  selectedFiles,
  isSubmitting,
  onFilesSelected,
  onSubmit,
}) => {
  return (
    <div className="file-upload-sector">
      <p className="form-hint">
        Upload technical specifications, documentation, whitepapers, manuals, or project files. Extracted text will be automatically indexed into pgvector for high-accuracy grounded retrieval.
      </p>

      <FileDropZone
        files={selectedFiles}
        onFilesSelected={onFilesSelected}
        disabled={isSubmitting}
        showFileList={true}
      />

      <div className="submit-action-bar">
        <button
          type="button"
          className="btn-primary btn-lg"
          onClick={onSubmit}
          disabled={selectedFiles.length === 0 || isSubmitting}
        >
          {isSubmitting ? 'Submitting Files...' : `Ingest ${selectedFiles.length} Document(s)`}
        </button>
      </div>
    </div>
  );
});

FileUploadSector.displayName = 'FileUploadSector';


