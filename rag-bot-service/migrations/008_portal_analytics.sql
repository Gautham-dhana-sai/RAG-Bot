-- Migration 008: Portal-Level Analytics & AI Token Attribution
-- PersonaRAG Analytics Data Layer

-- 1. Analytics Events (Comprehensive Lifecycle & Operation Log)
CREATE TABLE IF NOT EXISTS analytics_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    entity_id UUID NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    request_origin VARCHAR(50) NOT NULL DEFAULT 'PORTAL_UI', -- 'PORTAL_UI', 'EXTERNAL_INTEGRATION'
    source_id UUID,
    document_id UUID,
    document_version_id UUID,
    ingestion_job_id UUID,
    crawl_job_id UUID,
    conversation_id UUID,
    session_id VARCHAR(255),
    request_id VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'SUCCESS', -- 'SUCCESS', 'FAILED', 'PROCESSING', 'SKIPPED', 'UNCHANGED'
    duration_ms INT,
    source_category VARCHAR(50), -- 'FILE', 'LINK', 'WEBSITE'
    file_type VARCHAR(50), -- 'pdf', 'docx', 'txt', 'png', etc.
    stage VARCHAR(50), -- 'DOWNLOAD', 'EXTRACTION', 'CHUNKING', 'EMBEDDING', 'STORAGE'
    failure_category VARCHAR(100), -- 'unsupported_file_type', 'download_failure', etc.
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_analytics_entity FOREIGN KEY (tenant_id, entity_id) REFERENCES entities(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_entity_created ON analytics_events (entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_tenant_entity ON analytics_events (tenant_id, entity_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events (entity_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_origin ON analytics_events (entity_id, request_origin);
CREATE INDEX IF NOT EXISTS idx_analytics_events_status ON analytics_events (entity_id, status);

-- 2. AI Token Logs (Exact Provider Usage per Model Call)
CREATE TABLE IF NOT EXISTS ai_token_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    entity_id UUID NOT NULL,
    request_origin VARCHAR(50) NOT NULL DEFAULT 'PORTAL_UI', -- 'PORTAL_UI', 'EXTERNAL_INTEGRATION'
    operation_type VARCHAR(50) NOT NULL, -- 'CHAT_COMPLETION', 'EMBEDDING', 'QUERY_REWRITE'
    provider VARCHAR(50) NOT NULL, -- 'openai', 'gemini', 'cohere', 'mock'
    model_name VARCHAR(100) NOT NULL,
    input_tokens INT NOT NULL DEFAULT 0,
    output_tokens INT NOT NULL DEFAULT 0,
    total_tokens INT NOT NULL DEFAULT 0,
    is_estimated BOOLEAN NOT NULL DEFAULT FALSE,
    conversation_id UUID,
    session_id VARCHAR(255),
    request_id VARCHAR(255),
    duration_ms INT NOT NULL DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'SUCCESS',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_ai_token_logs_entity FOREIGN KEY (tenant_id, entity_id) REFERENCES entities(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_token_logs_entity_date ON ai_token_logs (entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_token_logs_origin ON ai_token_logs (entity_id, request_origin, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_token_logs_op ON ai_token_logs (entity_id, operation_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_token_logs_tenant_entity ON ai_token_logs (tenant_id, entity_id);

-- 3. Portal Daily Analytics Aggregation Rollup Table
CREATE TABLE IF NOT EXISTS portal_daily_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    entity_id UUID NOT NULL,
    date DATE NOT NULL,
    total_sources INT NOT NULL DEFAULT 0,
    new_uploads INT NOT NULL DEFAULT 0,
    successful_ingestions INT NOT NULL DEFAULT 0,
    failed_ingestions INT NOT NULL DEFAULT 0,
    refetch_operations INT NOT NULL DEFAULT 0,
    unchanged_refetches INT NOT NULL DEFAULT 0,
    chat_questions_portal_ui INT NOT NULL DEFAULT 0,
    chat_questions_external INT NOT NULL DEFAULT 0,
    input_tokens_portal_ui BIGINT NOT NULL DEFAULT 0,
    output_tokens_portal_ui BIGINT NOT NULL DEFAULT 0,
    input_tokens_external BIGINT NOT NULL DEFAULT 0,
    output_tokens_external BIGINT NOT NULL DEFAULT 0,
    embedding_tokens BIGINT NOT NULL DEFAULT 0,
    avg_processing_duration_ms INT NOT NULL DEFAULT 0,
    avg_chat_response_ms INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_daily_analytics_entity FOREIGN KEY (tenant_id, entity_id) REFERENCES entities(tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_daily_entity_date UNIQUE (entity_id, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_analytics_entity_date ON portal_daily_analytics (entity_id, date DESC);

