-- Migration 004: URL Ingestion Support & Object Key Indexing

-- 1. Extend ingestion_jobs with source_type and metadata
ALTER TABLE ingestion_jobs 
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(50) NOT NULL DEFAULT 'DIRECT_UPLOAD',
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 2. Extend ingestion_job_documents with source_url, stage, and download_metadata
ALTER TABLE ingestion_job_documents 
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS stage VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS download_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 3. Add high-performance indexes for S3 event reconciliation and URL tracking
CREATE INDEX IF NOT EXISTS idx_documents_object_key ON documents (object_key);
CREATE INDEX IF NOT EXISTS idx_job_docs_source_url ON ingestion_job_documents (source_url);
CREATE INDEX IF NOT EXISTS idx_job_docs_document_id ON ingestion_job_documents (document_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_source_type ON ingestion_jobs (source_type);

