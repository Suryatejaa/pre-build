-- Additive reader/writer evolution. No UPDATE of historical versions or audit rows.
ALTER TABLE project_versions DROP CONSTRAINT project_versions_schema_version_check;
ALTER TABLE project_versions ADD CONSTRAINT project_versions_supported_schema CHECK (schema_version IN (1, 2));
ALTER TABLE project_versions ADD CONSTRAINT project_versions_site_presence CHECK (
  (schema_version = 1 AND NOT snapshot ? 'site') OR
  (schema_version = 2 AND snapshot ? 'site')
);

-- Relational geometry/provenance invariants also apply to direct database inserts.
-- Detailed input, self-intersection, and calculator equality validation remains in the domain reader/writer.
CREATE FUNCTION valid_site_snapshot(site jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  facts jsonb; derived jsonb; boundary jsonb; vertices jsonb; edges jsonb;
  point jsonb; edge jsonb; road jsonb; next_point jsonb;
  point_ids text[] := ARRAY[]::text[]; edge_ids text[] := ARRAY[]::text[]; road_ids text[] := ARRAY[]::text[];
  road_edges text[] := ARRAY[]::text[];
  i integer; primary_count integer := 0; twice_area numeric := 0; squared numeric;
BEGIN
  IF site = 'null'::jsonb THEN RETURN true; END IF;
  IF jsonb_typeof(site) IS DISTINCT FROM 'object' OR site->>'siteSchemaVersion' IS DISTINCT FROM '1' THEN RETURN false; END IF;
  facts := site->'facts'; derived := site->'derived'; boundary := derived->'boundary';
  IF jsonb_typeof(facts) IS DISTINCT FROM 'object' OR jsonb_typeof(derived) IS DISTINCT FROM 'object'
    OR derived->>'calculatorVersion' IS DISTINCT FROM '1' OR jsonb_typeof(facts->'roads') IS DISTINCT FROM 'array'
    OR jsonb_typeof(facts->'identity') IS DISTINCT FROM 'object' OR jsonb_typeof(facts->'location') IS DISTINCT FROM 'object'
    OR jsonb_typeof(facts->'orientation') IS DISTINCT FROM 'object' OR jsonb_typeof(facts->'conditions') IS DISTINCT FROM 'object'
    THEN RETURN false; END IF;
  IF (facts->'conditions'->>'status' IN ('UNKNOWN','VACANT','EXISTING_STRUCTURE','DEMOLITION_EXPECTED')) IS NOT TRUE THEN RETURN false; END IF;
  IF facts->'location' ? 'latitude' AND ((facts->'location'->>'latitude')::numeric BETWEEN -90 AND 90) IS NOT TRUE THEN RETURN false; END IF;
  IF facts->'location' ? 'longitude' AND ((facts->'location'->>'longitude')::numeric BETWEEN -180 AND 180) IS NOT TRUE THEN RETURN false; END IF;
  IF facts->'orientation' ? 'northAngleMilliDegrees' AND
    ((facts->'orientation'->>'northAngleMilliDegrees')::numeric BETWEEN 0 AND 359999 AND
      mod((facts->'orientation'->>'northAngleMilliDegrees')::numeric,1)=0) IS NOT TRUE THEN RETURN false; END IF;
  IF boundary = 'null'::jsonb THEN
    RETURN facts->'boundary' = 'null'::jsonb AND derived->'calculatedArea' = 'null'::jsonb
      AND jsonb_array_length(facts->'roads')=0 AND NOT facts->'orientation' ? 'frontEdgeId';
  END IF;
  IF jsonb_typeof(boundary) IS DISTINCT FROM 'object' OR boundary->>'unit' IS DISTINCT FROM 'mm'
    OR boundary->>'coordinateSystem' IS DISTINCT FROM 'LOCAL_CARTESIAN' OR boundary->>'closure' IS DISTINCT FROM 'LAST_TO_FIRST'
    OR (boundary->>'winding' IN ('CW','CCW')) IS NOT TRUE THEN RETURN false; END IF;
  vertices := boundary->'vertices'; edges := boundary->'edges';
  IF jsonb_typeof(vertices) IS DISTINCT FROM 'array' OR jsonb_typeof(edges) IS DISTINCT FROM 'array'
    OR jsonb_array_length(vertices) NOT BETWEEN 3 AND 32 OR jsonb_array_length(vertices) <> jsonb_array_length(edges) THEN RETURN false; END IF;
  FOR i IN 0..jsonb_array_length(vertices)-1 LOOP
    point := vertices->i; next_point := vertices->((i+1)%jsonb_array_length(vertices)); edge := edges->i;
    PERFORM (point->>'id')::uuid, (edge->>'id')::uuid;
    IF point->>'id' IS NULL OR edge->>'id' IS NULL OR point_ids @> ARRAY[point->>'id'] OR edge_ids @> ARRAY[edge->>'id'] THEN RETURN false; END IF;
    point_ids := array_append(point_ids,point->>'id'); edge_ids := array_append(edge_ids,edge->>'id');
    IF jsonb_typeof(point->'x') IS DISTINCT FROM 'number' OR jsonb_typeof(point->'y') IS DISTINCT FROM 'number'
      OR abs((point->>'x')::numeric)>10000000 OR abs((point->>'y')::numeric)>10000000
      OR mod((point->>'x')::numeric,1)<>0 OR mod((point->>'y')::numeric,1)<>0 THEN RETURN false; END IF;
    IF edge->>'fromVertexId' IS DISTINCT FROM point->>'id' OR edge->>'toVertexId' IS DISTINCT FROM next_point->>'id'
      OR edge->'length'->>'unit' IS DISTINCT FROM 'mm' THEN RETURN false; END IF;
    squared := ((next_point->>'x')::numeric-(point->>'x')::numeric)^2 + ((next_point->>'y')::numeric-(point->>'y')::numeric)^2;
    IF squared<=0 OR ((edge->>'lengthSquaredMm2')::numeric=squared) IS NOT TRUE
      OR ((edge->'length'->>'value')::numeric=round(sqrt(squared))) IS NOT TRUE THEN RETURN false; END IF;
    twice_area := twice_area + (point->>'x')::numeric*(next_point->>'y')::numeric-(point->>'y')::numeric*(next_point->>'x')::numeric;
  END LOOP;
  IF point_ids && edge_ids OR twice_area=0 OR derived->'calculatedArea'->>'unit' IS DISTINCT FROM 'mm2'
    OR ((derived->'calculatedArea'->>'value')::numeric=abs(twice_area)/2) IS NOT TRUE THEN RETURN false; END IF;
  IF facts->'orientation' ? 'frontEdgeId' AND NOT edge_ids @> ARRAY[facts->'orientation'->>'frontEdgeId'] THEN RETURN false; END IF;
  FOR road IN SELECT value FROM jsonb_array_elements(facts->'roads') LOOP
    PERFORM (road->>'id')::uuid;
    IF road->>'id' IS NULL OR road_ids @> ARRAY[road->>'id'] OR road_edges @> ARRAY[road->>'edgeId']
      OR NOT edge_ids @> ARRAY[road->>'edgeId'] OR jsonb_typeof(road->'primaryAccess') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
    road_ids := array_append(road_ids,road->>'id'); road_edges := array_append(road_edges,road->>'edgeId');
    IF (road->>'primaryAccess')::boolean THEN primary_count := primary_count+1; END IF;
  END LOOP;
  RETURN primary_count<=1;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;
ALTER TABLE project_versions ADD CONSTRAINT project_versions_valid_site
  CHECK (schema_version = 1 OR valid_site_snapshot(snapshot->'site') IS TRUE);
