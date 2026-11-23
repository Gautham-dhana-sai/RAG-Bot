-- Migration 009: Backfill historical document embedding tokens and processing performance into analytics tables
-- Ensures existing documents immediately reflect in AI token consumption and processing duration analytics.

-- 1. Backfill embedding token logs from existing document chunks
INSERT INTO ai_token_logs (
    id,
    tenant_id,
    entity_id,
    request_origin,
    operation_type,
    provider,
    model_name,
    input_tokens,
    output_tokens,
    total_tokens,
    is_estimated,
    duration_ms,
    status,
    metadata,
    created_at
)
SELECT
    gen_random_uuid(),
    d.tenant_id,
    d.entity_id,
    'PORTAL_UI',
    'EMBEDDING',
    'gemini',
    'gemini-embedding-001',
    ROUND(COALESCE(SUM(LENGTH(c.chunk_text) / 4), 100))::int,
    0,
    ROUND(COALESCE(SUM(LENGTH(c.chunk_text) / 4), 100))::int,
    true,
    GREATEST(500, ROUND(EXTRACT(EPOCH FROM (d.updated_at - d.created_at)) * 300))::int,
    'SUCCESS',
    jsonb_build_object('documentId', d.id, 'filename', d.original_filename, 'isBackfill', true),
    d.created_at
FROM documents d
JOIN document_chunks c ON c.document_id = d.id
WHERE d.status = 'READY'
  AND NOT EXISTS (
    SELECT 1 FROM ai_token_logs l
    WHERE l.entity_id = d.entity_id
      AND l.operation_type = 'EMBEDDING'
      AND (l.metadata->>'documentId' = d.id::text OR l.created_at = d.created_at)
  )
GROUP BY d.id, d.tenant_id, d.entity_id, d.created_at, d.updated_at;

-- 2. Backfill INGESTION_COMPLETION events for existing READY documents
INSERT INTO analytics_events (
    id,
    tenant_id,
    entity_id,
    event_type,
    request_origin,
    document_id,
    status,
    duration_ms,
    source_category,
    file_type,
    stage,
    metadata,
    created_at
)
SELECT
    gen_random_uuid(),
    d.tenant_id,
    d.entity_id,
    'INGESTION_COMPLETION',
    'PORTAL_UI',
    d.id,
    'SUCCESS',
    GREATEST(800, ROUND(EXTRACT(EPOCH FROM (d.updated_at - d.created_at)) * 1000))::int,
    CASE
      WHEN d.source_type IN ('WEBSITE_IMPORT', 'WEBSITE_CRAWL') THEN 'WEBSITE'
      WHEN d.source_type = 'URL_IMPORT' THEN 'LINK'
      ELSE 'FILE'
    END,
    CASE
      WHEN d.mime_type ILIKE '%pdf%' THEN 'pdf'
      WHEN d.mime_type ILIKE '%word%' OR d.mime_type ILIKE '%docx%' THEN 'docx'
      WHEN d.mime_type ILIKE '%doc%' THEN 'doc'
      WHEN d.mime_type ILIKE '%plain%' THEN 'txt'
      WHEN d.mime_type ILIKE '%markdown%' THEN 'markdown'
      WHEN d.mime_type ILIKE '%png%' THEN 'png'
      WHEN d.mime_type ILIKE '%jpeg%' OR d.mime_type ILIKE '%jpg%' THEN 'jpeg'
      WHEN d.mime_type ILIKE '%webp%' THEN 'webp'
      ELSE 'other'
    END,
    'STORAGE',
    jsonb_build_object('filename', d.original_filename, 'isBackfill', true),
    d.created_at
FROM documents d
WHERE d.status = 'READY'
  AND NOT EXISTS (
    SELECT 1 FROM analytics_events e
    WHERE e.entity_id = d.entity_id
      AND e.event_type = 'INGESTION_COMPLETION'
      AND e.document_id = d.id
  );
