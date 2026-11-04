-- Migration 006: Add source_type to documents table for explicit source differentiation
ALTER TABLE documents 
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(50) NOT NULL DEFAULT 'DIRECT_UPLOAD';

CREATE INDEX IF NOT EXISTS idx_documents_source_type ON documents (source_type);

