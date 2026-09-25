-- The runner executes this migration and its checksum ledger write in one transaction.
-- 001 used an unnamed CHECK. Locate only that propertyType constraint; fail closed
-- if the expected historical constraint is missing rather than dropping other validation.
DO $$
DECLARE
  legacy_constraint text;
BEGIN
  SELECT conname INTO STRICT legacy_constraint
  FROM pg_constraint
  WHERE conrelid = 'project_versions'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%propertyType%RESIDENTIAL_HOUSE%';
  EXECUTE format('ALTER TABLE project_versions DROP CONSTRAINT %I', legacy_constraint);
END;
$$;

-- Existing JSON and append-only triggers remain untouched. Retain the old spelling
-- for historical V1/V2/V3 records while allowing the four canonical types going forward.
ALTER TABLE project_versions ADD CONSTRAINT project_versions_property_type CHECK (
  (jsonb_typeof(snapshot->'propertyType') = 'string'
    AND snapshot->>'propertyType' IN ('RESIDENTIAL_HOUSE', 'RESIDENTIAL', 'COMMERCIAL', 'MIXED_USE', 'OTHER')) IS TRUE
);
