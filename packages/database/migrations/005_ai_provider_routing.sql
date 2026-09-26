-- Existing append-only records remain untouched; legacy rows have an empty trace.
ALTER TABLE requirements_ai_requests
  ADD COLUMN attempts jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(attempts) = 'array' AND jsonb_array_length(attempts) <= 16),
  ADD COLUMN routing_outcome text NOT NULL DEFAULT 'LEGACY'
    CHECK (routing_outcome IN ('LEGACY','PRIMARY_USED','FALLBACK_USED','ALL_PROVIDERS_FAILED','OPERATOR_ERROR','NOT_CONFIGURED'));
ALTER TABLE requirements_ai_requests DROP CONSTRAINT requirements_ai_requests_retry_count_check;
ALTER TABLE requirements_ai_requests ADD CONSTRAINT requirements_ai_requests_retry_count_check CHECK (retry_count BETWEEN 0 AND 8);
