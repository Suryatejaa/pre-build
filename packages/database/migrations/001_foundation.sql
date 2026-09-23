-- Auth-owned tables. Names match the Better Auth PostgreSQL adapter.
CREATE TABLE "user" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  email text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false,
  image text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX user_email_case_insensitive ON "user" (lower(email));
CREATE TABLE session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "userId" uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE, "expiresAt" timestamptz NOT NULL,
  "ipAddress" text, "userAgent" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_by_user ON session ("userId");
CREATE INDEX session_expiry ON session ("expiresAt");
CREATE TABLE account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "userId" uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "accountId" text NOT NULL, "providerId" text NOT NULL,
  "accessToken" text, "refreshToken" text, "idToken" text, password text, scope text,
  "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("providerId", "accountId")
);
CREATE INDEX account_user ON account ("userId");
CREATE TABLE verification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), identifier text NOT NULL, value text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_identifier ON verification (identifier);
CREATE TABLE "rateLimit" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key text NOT NULL UNIQUE,
  count integer NOT NULL, "lastRequest" bigint NOT NULL
);

-- Only stable identity/ownership/pointer live here; versioned property facts have one source of truth.
CREATE TABLE property_projects (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  current_revision integer NOT NULL CHECK (current_revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX projects_owner ON property_projects (owner_user_id, created_at DESC, id);
CREATE TABLE project_versions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES property_projects(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision > 0),
  schema_version integer NOT NULL CHECK (schema_version = 1),
  snapshot jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('HUMAN', 'AI', 'SYSTEM')),
  change_reason text NOT NULL CHECK (length(btrim(change_reason)) BETWEEN 5 AND 500),
  UNIQUE (project_id, revision), UNIQUE (project_id, id),
  CHECK (jsonb_typeof(snapshot) = 'object'),
  CHECK (snapshot ?& ARRAY['schemaVersion','projectId','name','propertyType','status']),
  CHECK (((snapshot->>'schemaVersion')::integer = schema_version) IS TRUE),
  CHECK (((snapshot->>'projectId')::uuid = project_id) IS TRUE),
  CHECK ((jsonb_typeof(snapshot->'name') = 'string' AND length(btrim(snapshot->>'name')) BETWEEN 2 AND 120) IS TRUE),
  CHECK ((snapshot->>'propertyType' = 'RESIDENTIAL_HOUSE') IS TRUE),
  CHECK ((snapshot->>'status' IN ('ACTIVE', 'ARCHIVED')) IS TRUE)
);
ALTER TABLE property_projects ADD CONSTRAINT projects_current_version
  FOREIGN KEY (id, current_revision) REFERENCES project_versions(project_id, revision)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE project_memberships (
  project_id uuid NOT NULL REFERENCES property_projects(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('CONTRACTOR_VIEWER','CONTRACTOR_CONTRIBUTOR','PROFESSIONAL')),
  granted_by uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX memberships_user ON project_memberships (user_id, project_id);
CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES property_projects(id) ON DELETE RESTRICT,
  project_version_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('PROJECT_CREATED','PROJECT_UPDATED','MEMBER_ASSIGNED','MEMBER_REMOVED')),
  source text NOT NULL CHECK (source IN ('HUMAN','AI','SYSTEM')),
  before_data jsonb, after_data jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, project_version_id) REFERENCES project_versions(project_id, id)
);
CREATE INDEX audit_project_time ON audit_events (project_id, occurred_at DESC);

CREATE FUNCTION reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Historical records are append-only'; END;
$$;
CREATE TRIGGER versions_immutable BEFORE UPDATE OR DELETE ON project_versions
  FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE FUNCTION protect_project_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.owner_user_id <> OLD.owner_user_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Project identity and ownership are immutable';
  END IF;
  IF NEW.current_revision <> OLD.current_revision + 1 THEN
    RAISE EXCEPTION 'Project revision must advance by exactly one';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER project_identity_immutable BEFORE UPDATE ON property_projects
  FOR EACH ROW EXECUTE FUNCTION protect_project_identity();
CREATE FUNCTION protect_owner_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM property_projects WHERE id = NEW.project_id AND owner_user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'Owner role is derived from project ownership';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER owner_membership_guard BEFORE INSERT OR UPDATE ON project_memberships
  FOR EACH ROW EXECUTE FUNCTION protect_owner_membership();
