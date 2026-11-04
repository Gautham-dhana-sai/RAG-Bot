-- Migration 005: Multi-Page Website Crawling & Page Tracking

CREATE TABLE IF NOT EXISTS crawl_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    entity_id UUID NOT NULL,
    root_url TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'queued', -- queued, discovering, processing_pages, completed, completed_with_errors, failed, cancelled
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    discovered_count INT NOT NULL DEFAULT 0,
    queued_count INT NOT NULL DEFAULT 0,
    processing_count INT NOT NULL DEFAULT 0,
    completed_count INT NOT NULL DEFAULT 0,
    failed_count INT NOT NULL DEFAULT 0,
    skipped_count INT NOT NULL DEFAULT 0,
    error_summary TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT fk_crawl_entity FOREIGN KEY (tenant_id, entity_id) REFERENCES entities(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS crawl_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    entity_id UUID NOT NULL,
    crawl_job_id UUID NOT NULL,
    document_id UUID,
    original_url TEXT NOT NULL,
    normalized_url TEXT NOT NULL,
    canonical_url TEXT,
    title TEXT,
    content_hash VARCHAR(64),
    object_key VARCHAR(1000),
    status VARCHAR(50) NOT NULL DEFAULT 'discovered', -- discovered, queued, fetching, extracting, uploaded, ingesting, completed, skipped, failed
    stage VARCHAR(50) NOT NULL DEFAULT 'DISCOVERED',
    depth INT NOT NULL DEFAULT 0,
    retry_count INT NOT NULL DEFAULT 0,
    size_bytes BIGINT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT fk_crawl_page_job FOREIGN KEY (crawl_job_id) REFERENCES crawl_jobs(id) ON DELETE CASCADE,
    CONSTRAINT uq_crawl_job_url UNIQUE (crawl_job_id, normalized_url)
);

CREATE INDEX IF NOT EXISTS idx_crawl_jobs_tenant_entity ON crawl_jobs (tenant_id, entity_id);
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_status ON crawl_jobs (status);
CREATE INDEX IF NOT EXISTS idx_crawl_pages_job_status ON crawl_pages (crawl_job_id, status);
CREATE INDEX IF NOT EXISTS idx_crawl_pages_document_id ON crawl_pages (document_id);

