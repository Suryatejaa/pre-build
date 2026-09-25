-- Phase 3: interviews are mutable working records; approved requirements enter immutable V3 snapshots.
CREATE OR REPLACE FUNCTION valid_property_requirements(value jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN jsonb_typeof(value) = 'object'
    AND value->>'requirementsSchemaVersion' = '1'
    AND value ?& ARRAY['buildingIntent','occupancy','buildingScale','spaces','relationships','parking','accessibility','utilities','rental','preferences','budget','timeline','vaasthuPreference','futureExpansion']
    AND jsonb_typeof(value->'occupancy') = 'object'
    AND jsonb_typeof(value->'buildingScale') = 'object'
    AND jsonb_typeof(value->'spaces') = 'array'
    AND jsonb_typeof(value->'relationships') = 'array'
    AND jsonb_typeof(value->'parking') = 'array'
    AND jsonb_typeof(value->'accessibility') = 'array'
    AND jsonb_typeof(value->'utilities') = 'array'
    AND jsonb_typeof(value->'rental') = 'object'
    AND jsonb_typeof(value->'preferences') = 'array'
    AND jsonb_typeof(value->'budget') = 'object'
    AND jsonb_typeof(value->'timeline') = 'object'
    AND jsonb_typeof(value->'futureExpansion') = 'array';
END;
$$;

ALTER TABLE project_versions DROP CONSTRAINT project_versions_supported_schema;
ALTER TABLE project_versions ADD CONSTRAINT project_versions_supported_schema CHECK (schema_version IN (1, 2, 3));
ALTER TABLE project_versions DROP CONSTRAINT project_versions_site_presence;
ALTER TABLE project_versions ADD CONSTRAINT project_versions_site_presence CHECK (
  (schema_version = 1 AND NOT snapshot ? 'site') OR (schema_version IN (2, 3) AND snapshot ? 'site')
);
ALTER TABLE project_versions ADD CONSTRAINT project_versions_requirements_presence CHECK (
  (schema_version IN (1, 2) AND NOT snapshot ? 'requirements') OR
  (schema_version = 3 AND snapshot ? 'requirements' AND valid_property_requirements(snapshot->'requirements') IS TRUE)
);

ALTER TABLE property_projects ADD CONSTRAINT projects_id_owner_unique UNIQUE (id, owner_user_id);

ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK (action IN (
  'PROJECT_CREATED','PROJECT_UPDATED','MEMBER_ASSIGNED','MEMBER_REMOVED',
  'REQUIREMENTS_INTERVIEW_STARTED','REQUIREMENTS_MANUALLY_EDITED','REQUIREMENTS_CONFLICT_RESOLVED',
  'REQUIREMENTS_APPROVED','REQUIREMENTS_INTERVIEW_REOPENED'
));

CREATE TABLE requirements_interviews (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('IN_PROGRESS','REVIEW_REQUIRED','APPROVED','SUPERSEDED')),
  candidate jsonb NOT NULL CHECK (
    jsonb_typeof(candidate) = 'object' AND candidate ?& ARRAY['requirements','questions','conflicts','siteDiscrepancies','lastAiError','lastOwnerMessageId']
    AND valid_property_requirements(candidate->'requirements') IS TRUE
    AND jsonb_typeof(candidate->'questions') = 'array'
    AND jsonb_typeof(candidate->'conflicts') = 'array'
    AND jsonb_typeof(candidate->'siteDiscrepancies') = 'array'
  ),
  expected_project_revision integer NOT NULL CHECK (expected_project_revision > 0),
  approved_project_version_id uuid,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (project_id, id),
  FOREIGN KEY (project_id, owner_id) REFERENCES property_projects(id, owner_user_id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, approved_project_version_id) REFERENCES project_versions(project_id, id),
  CHECK ((status = 'APPROVED' AND approved_project_version_id IS NOT NULL) OR (status <> 'APPROVED' AND approved_project_version_id IS NULL))
);
CREATE UNIQUE INDEX requirements_one_active_interview ON requirements_interviews(project_id) WHERE status IN ('IN_PROGRESS','REVIEW_REQUIRED');
CREATE INDEX requirements_interviews_project_time ON requirements_interviews(project_id, created_at DESC, id DESC);

CREATE TABLE requirements_interview_messages (
  id uuid PRIMARY KEY,
  interview_id uuid NOT NULL REFERENCES requirements_interviews(id) ON DELETE RESTRICT,
  sequence_no integer NOT NULL CHECK (sequence_no > 0),
  role text NOT NULL CHECK (role IN ('OWNER','ASSISTANT')),
  content text NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 4000),
  provider text CHECK (provider IS NULL OR length(provider) BETWEEN 1 AND 80),
  model text CHECK (model IS NULL OR length(model) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL,
  UNIQUE (interview_id, sequence_no),
  UNIQUE (interview_id, id)
);
CREATE INDEX requirements_messages_order ON requirements_interview_messages(interview_id, sequence_no);

CREATE TABLE requirements_ai_requests (
  id uuid PRIMARY KEY,
  interview_id uuid NOT NULL REFERENCES requirements_interviews(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (length(provider) BETWEEN 1 AND 80),
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 160),
  request_type text NOT NULL CHECK (request_type IN ('INTERPRET_OWNER_MESSAGE','GENERATE_FOLLOW_UP')),
  occurred_at timestamptz NOT NULL,
  succeeded boolean NOT NULL,
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  retry_count integer NOT NULL CHECK (retry_count BETWEEN 0 AND 3)
);
CREATE INDEX requirements_ai_requests_interview_time ON requirements_ai_requests(interview_id, occurred_at DESC);

CREATE TRIGGER requirements_interview_messages_immutable BEFORE UPDATE OR DELETE ON requirements_interview_messages
  FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER requirements_ai_requests_immutable BEFORE UPDATE OR DELETE ON requirements_ai_requests
  FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
