import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createProjectUnitOfWork, isDatabaseReady } from '@property/database';
import { migrate } from '@property/database/migrate';
import { emptyPropertyRequirements, propertyTypeSchema } from '@property/domain';
import { ProjectService } from '@property/services';
import { rectangleFacts } from './site-fixtures';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !new URL(connectionString).pathname.endsWith('_test')) throw new Error('An isolated TEST_DATABASE_URL ending in _test is required.');
const migrations = ['001_foundation.sql', '002_site_intake.sql', '003_property_requirements.sql'];

describe.each([1, 2, 3])('populated Phase %i upgrade', phase => {
  const schema = `test_upgrade_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString });
  const pool = new Pool({ connectionString, options: `-c search_path=${schema},public` });
  beforeAll(async () => { await admin.query(`CREATE SCHEMA ${schema}`); });
  afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
  it('preserves historical JSON and audit, validates new values, and tracks migration checksums/readiness', async () => {
    await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const name of migrations.slice(0, phase)) {
      const sql = await readFile(new URL(`../packages/database/migrations/${name}`, import.meta.url), 'utf8');
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [name, createHash('sha256').update(sql).digest('hex')]);
    }
    const owner = { userId: randomUUID() }, projectId = randomUUID();
    await pool.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)', [owner.userId, 'Upgrade test', `${owner.userId}@example.test`]);
    // Seed the historical SQL shape directly: current application writes must use canonical types.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO property_projects(id,owner_user_id,current_revision) VALUES($1,$2,1)', [projectId, owner.userId]);
      for (let revision = 1; revision <= phase; revision++) {
        const snapshot = { schemaVersion: revision, projectId, name: 'Historical home', propertyType: 'RESIDENTIAL_HOUSE', status: 'ACTIVE',
          ...(revision >= 2 ? { site: null } : {}), ...(revision === 3 ? { requirements: emptyPropertyRequirements() } : {}) };
        const versionId = randomUUID();
        await client.query(`INSERT INTO project_versions(id,project_id,revision,schema_version,snapshot,created_by,source,change_reason)
          VALUES($1,$2,$3,$3,$4,$5,'HUMAN','Historical project record')`, [versionId, projectId, revision, snapshot, owner.userId]);
        if (revision > 1) await client.query('UPDATE property_projects SET current_revision=$2 WHERE id=$1', [projectId, revision]);
        await client.query(`INSERT INTO audit_events(id,project_id,project_version_id,actor_id,action,before_data,after_data,source)
          VALUES($1,$2,$3,$4,'PROJECT_CREATED',null,$5,'HUMAN')`, [randomUUID(), projectId, versionId, owner.userId, snapshot]);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    let legacyAiRequestId: string | undefined;
    if (phase === 3) {
      const interviewId = randomUUID(); legacyAiRequestId = randomUUID();
      await pool.query(`INSERT INTO requirements_interviews(id,project_id,owner_id,status,candidate,expected_project_revision,created_at,updated_at)
        VALUES($1,$2,$3,'IN_PROGRESS',$4,3,now(),now())`, [interviewId, projectId, owner.userId, { requirements: emptyPropertyRequirements(), questions: [], conflicts: [], siteDiscrepancies: [], lastAiError: null, lastOwnerMessageId: null }]);
      await pool.query(`INSERT INTO requirements_ai_requests(id,interview_id,provider,model,request_type,occurred_at,succeeded,latency_ms,input_tokens,output_tokens,retry_count)
        VALUES($1,$2,'historical-provider','historical-model','INTERPRET_OWNER_MESSAGE',now(),true,20,5,0,1)`, [legacyAiRequestId, interviewId]);
    }
    const legacyAi = legacyAiRequestId ? (await pool.query('SELECT row_to_json(r) AS value FROM requirements_ai_requests r WHERE id=$1', [legacyAiRequestId])).rows[0].value : null;
    const versions = (await pool.query('SELECT row_to_json(v)::text AS value FROM project_versions v ORDER BY revision')).rows;
    const audit = (await pool.query('SELECT row_to_json(a)::text AS value FROM audit_events a ORDER BY occurred_at,id')).rows;
    expect(await isDatabaseReady(pool)).toBe(false);
    await migrate(pool);
    expect(await isDatabaseReady(pool)).toBe(true);
    if (legacyAiRequestId) {
      const upgradedAi = (await pool.query('SELECT row_to_json(r) AS value FROM requirements_ai_requests r WHERE id=$1', [legacyAiRequestId])).rows[0].value;
      expect(upgradedAi).toEqual({ ...legacyAi, attempts: [], routing_outcome: 'LEGACY' });
    }

    expect((await pool.query('SELECT row_to_json(v)::text AS value FROM project_versions v ORDER BY revision')).rows).toEqual(versions);
    expect((await pool.query('SELECT row_to_json(a)::text AS value FROM audit_events a ORDER BY occurred_at,id')).rows).toEqual(audit);
    const service = new ProjectService(createProjectUnitOfWork(pool), randomUUID, () => new Date());
    expect((await service.get(owner, projectId)).propertyType).toBe('RESIDENTIAL');
    expect((await service.versions(owner, projectId)).items.every(v => v.snapshot.propertyType === 'RESIDENTIAL_HOUSE')).toBe(true);
    expect((await service.site(owner, projectId)).site).toBeNull();
    const noChange = await service.update(owner, projectId, { expectedRevision: phase, propertyType: 'RESIDENTIAL', changeReason: 'Same normalized property type' });
    expect(noChange.revision).toBe(phase);
    await service.saveSite(owner, projectId, { expectedRevision: phase, changeReason: 'First site entry after upgrade', site: rectangleFacts() });
    const history = (await service.versions(owner, projectId)).items;
    expect(history[0]!.snapshot.site?.derived.calculatedArea?.value).toBe('200000000');
    expect(history[0]!.snapshot.propertyType).toBe('RESIDENTIAL');
    expect(history.slice(1).every(v => v.snapshot.propertyType === 'RESIDENTIAL_HOUSE')).toBe(true);
    for (const propertyType of propertyTypeSchema.options) {
      const created = await service.create(owner, { name: 'After upgrade', propertyType });
      expect((await service.version(owner, created.id, created.versionId)).snapshot.propertyType).toBe(propertyType);
    }
    for (const propertyType of ['INVALID', null, 3]) {
      const snapshot = { ...history[0]!.snapshot, propertyType };
      await expect(pool.query(`INSERT INTO project_versions(id,project_id,revision,schema_version,snapshot,created_by,source,change_reason)
        VALUES($1,$2,$3,$4,$5,$6,'HUMAN','Invalid property type test')`, [randomUUID(), projectId, phase + 2, snapshot.schemaVersion, snapshot, owner.userId])).rejects.toMatchObject({ code: '23514', constraint: 'project_versions_property_type' });
    }
    await migrate(pool);
    expect((await pool.query('SELECT count(*)::int AS count FROM schema_migrations')).rows[0].count).toBe(5);
    await pool.query('UPDATE schema_migrations SET checksum=$1 WHERE name=$2', ['test-corrupted-checksum', '004_project_property_types.sql']);
    await expect(migrate(pool)).rejects.toThrow('Applied migration changed');
  });
});
