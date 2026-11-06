-- Migration 007: Website Refetch, Document Versioning, and Source Management

-- 1. Add active_version_id to documents
ALTER TABLE documents 
  ADD COLUMN IF NOT EXISTS active_version_id UUID REFERENCES document_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documents_active_version ON documents (active_version_id);

-- Initialize active_version_id for existing documents from their latest document_version
UPDATE documents d
SET active_version_id = dv.id
FROM (
  SELECT DISTINCT ON (document_id) id, document_id
  FROM document_versions
  ORDER BY document_id, version_number DESC
) dv
WHERE d.id = dv.document_id AND d.active_version_id IS NULL;

-- 2. Add refetch and route reconciliation tracking to crawl_jobs
ALTER TABLE crawl_jobs
  ADD COLUMN IF NOT EXISTS last_refetched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refetch_status VARCHAR(50) NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS unchanged_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS changed_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS newly_discovered_count INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_crawl_jobs_refetch_status ON crawl_jobs (refetch_status);

-- 3. Add change tracking and version link to crawl_pages
ALTER TABLE crawl_pages
  ADD COLUMN IF NOT EXISTS is_unchanged BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS version_id UUID REFERENCES document_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_crawl_pages_version_id ON crawl_pages (version_id);

