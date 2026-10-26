import React, { useRef, useState } from 'react';
import { FileItem } from '../types';

interface FileDropZoneProps {
  files: FileItem[];
  onFilesSelected: (files: FileItem[]) => void;
  disabled?: boolean;
}

export const FileDropZone: React.FC<FileDropZoneProps> = ({ files, onFilesSelected, disabled }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (disabled || !e.dataTransfer.files) return;

    const newFiles: FileItem[] = Array.from(e.dataTransfer.files).map(f => ({
      file: f,
      name: f.name,
      size: f.size,
      type: f.type || 'unknown',
    }));

    onFilesSelected([...files, ...newFiles]);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;

    const newFiles: FileItem[] = Array.from(e.target.files).map(f => ({
      file: f,
      name: f.name,
      size: f.size,
      type: f.type || 'unknown',
    }));

    onFilesSelected([...files, ...newFiles]);
  };

  const handleRemove = (index: number) => {
    const updated = [...files];
    updated.splice(index, 1);
    onFilesSelected(updated);
  };

  return (
    <div className="dropzone-container">
      <div
        className={`dropzone ${isDragOver ? 'drag-over' : ''} ${disabled ? 'disabled' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !disabled && fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileInput}
          disabled={disabled}
        />
        <div className="dropzone-icon">📁</div>
        <div className="dropzone-text">
          <strong>Choose files</strong> or drag & drop them here
        </div>
        <div className="dropzone-hint">
          Supports PDF, DOCX, TXT, Markdown, and images (Max 25MB each)
        </div>
      </div>

      {files.length > 0 && (
        <div className="selected-files">
          <h4>Selected Documents ({files.length})</h4>
          <ul className="file-list">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="file-item">
                <span className="file-name">{f.name}</span>
                <span className="file-meta">
                  {(f.size / 1024).toFixed(1)} KB | {f.type || 'text'}
                </span>
                {!disabled && (
                  <button
                    type="button"
                    className="btn-remove"
                    onClick={e => {
                      e.stopPropagation();
                      handleRemove(i);
                    }}
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

