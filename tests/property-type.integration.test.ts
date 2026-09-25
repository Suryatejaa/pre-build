import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProjectUnitOfWork, createRequirementsUnitOfWork } from '@property/database';
import { migrate } from '@property/database/migrate';
import { propertyTypeSchema } from '@property/domain';
import { FakeRequirementsAiProvider, ProjectService, RequirementsInterviewService, type StructuredAiRequest } from '@property/services';
import { createProjectApi } from '../apps/web/src/server/project-api';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !new URL(connectionString).pathname.endsWith('_test')) throw new Error('An isolated TEST_DATABASE_URL ending in _test is required.');
const schema = `test_property_types_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString });
const pool = new Pool({ connectionString, options: `-c search_path=${schema},public` });
const projects = new ProjectService(createProjectUnitOfWork(pool), randomUUID, () => new Date());
const owner = { userId: randomUUID() }, member = { userId: randomUUID() }, stranger = { userId: randomUUID() };
const fake = new FakeRequirementsAiProvider();
let lastRequest: StructuredAiRequest | undefined;
const interviews = new RequirementsInterviewService(createRequirementsUnitOfWork(pool), {
  metadata: fake.metadata,
  async generateStructured(request) {
    lastRequest = request;
    const result = await fake.generateStructured(request);
    // A provider's redundant question must not become a deterministic follow-up.
    result.output.followUpQuestions.push('What kind of building do you want?');
    return result;
  },
  generateText: request => fake.generateText(request),
}, randomUUID, () => new Date());
const origin = 'http://localhost:3000';
const request = (method: string, body?: unknown) => new Request(`${origin}/api/projects`, { method,
  headers: { origin, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const api = createProjectApi(projects, { authenticate: async () => owner }, origin, interviews);
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`); await migrate(pool);
  for (const actor of [owner, member, stranger]) await pool.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)', [actor.userId, 'Property type test', `${actor.userId}@example.test`]);
});
afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

describe('property type HTTP → service → PostgreSQL', () => {
  it.each(propertyTypeSchema.options)('creates, lists and reads %s with canonical persisted data and known interview context', async propertyType => {
    const response = await api.collection(request('POST', { name: 'Property selection', propertyType }));
    expect(response.status).toBe(201);
    const project = await response.json();
    const freshService = new ProjectService(createProjectUnitOfWork(pool), randomUUID, () => new Date());
    expect((await freshService.get(owner, project.id)).propertyType).toBe(propertyType);
    expect((await projects.list(owner)).items.find(item => item.id === project.id)?.propertyType).toBe(propertyType);
    expect((await api.project(request('GET'), project.id)).status).toBe(200);
    expect((await pool.query('SELECT snapshot FROM project_versions WHERE id=$1', [project.versionId])).rows[0].snapshot.propertyType).toBe(propertyType);
    const started = await interviews.start(owner, project.id, { expectedRevision: 1 });
    expect(started.propertyType).toBe(propertyType);
    expect(started.interview?.candidate.requirements.buildingIntent).toMatchObject({ value: { kind: propertyType }, provenance: { current: { kind: 'PROJECT_CONTEXT', actorId: null, sourceMessageId: null } } });
    expect(started.interview?.candidate.questions).not.toContain('What kind of building do you want?');
    const replied = await interviews.sendMessage(owner, project.id, { expectedRevision: 1, content: 'G+1, 3 bedrooms, owner only.' });
    expect(lastRequest?.input).toMatchObject({ propertyType, currentCandidate: { buildingIntent: { value: { kind: propertyType } } } });
    expect(replied.interview?.candidate.questions).not.toContain('What kind of building do you want?');
    if (propertyType !== 'RESIDENTIAL') {
      expect(replied.completeness?.complete).toBe(false);
      expect(replied.completeness?.blockingItems.map(item => item.key)).toContain('buildingIntent.support');
      await expect(interviews.approve(owner, project.id, { expectedRevision: 1 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
  });
  it('rejects arbitrary creation/update values through safe HTTP validation', async () => {
    const response = await api.collection(request('POST', { name: 'Invalid type', propertyType: 'WAREHOUSE' }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_INPUT' } });
    const project = await projects.create(owner, { name: 'Invalid edit test' });
    expect((await api.project(request('PATCH', { propertyType: 'WAREHOUSE', expectedRevision: 1, changeReason: 'Invalid edit attempt' }), project.id)).status).toBe(422);
    expect((await projects.get(owner, project.id)).revision).toBe(1);
  });
  it('versions property edits, preserves history, audits, avoids no-ops and maps stale writes to HTTP 409', async () => {
    const project = await projects.create(owner, { name: 'Editable property' });
    const change = { propertyType: 'MIXED_USE', expectedRevision: 1, changeReason: 'Change planned use to mixed use' };
    const response = await api.project(request('PATCH', change), project.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ propertyType: 'MIXED_USE', revision: 2 });
    expect((await projects.version(owner, project.id, project.versionId)).snapshot.propertyType).toBe('RESIDENTIAL');
    expect((await projects.versions(owner, project.id)).items.map(v => v.snapshot.propertyType)).toEqual(['MIXED_USE', 'RESIDENTIAL']);
    expect((await api.project(request('PATCH', change), project.id)).status).toBe(409);
    expect((await projects.update(owner, project.id, { ...change, expectedRevision: 2 })).revision).toBe(2);
    const audit = (await pool.query("SELECT before_data,after_data,source,actor_id FROM audit_events WHERE project_id=$1 AND action='PROJECT_UPDATED'", [project.id])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ before_data: { propertyType: 'RESIDENTIAL' }, after_data: { propertyType: 'MIXED_USE' }, source: 'HUMAN', actor_id: owner.userId });
    await projects.assignMember(owner, project.id, { userId: member.userId, role: 'PROFESSIONAL' });
    await expect(projects.update(member, project.id, { ...change, expectedRevision: 2 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(projects.update(stranger, project.id, { ...change, expectedRevision: 2 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('Requirements alignment with canonical property type', () => {
  it('surfaces approved and draft mismatches, preserves approved history and uses controlled reopen', async () => {
    const project = await projects.create(owner, { name: 'Approved home becoming mixed use' });
    await interviews.start(owner, project.id, { expectedRevision: 1 });
    await interviews.sendMessage(owner, project.id, { expectedRevision: 1, content: 'G+1, 3 bedrooms, owner only.' });
    const approved = await interviews.approve(owner, project.id, { expectedRevision: 1 });
    const original = await projects.version(owner, project.id, approved.versionId);
    const originalInterview = (await pool.query('SELECT candidate,status FROM requirements_interviews WHERE id=$1', [approved.interview!.id])).rows[0];
    const updated = await projects.update(owner, project.id, { expectedRevision: 2, propertyType: 'MIXED_USE', changeReason: 'Change canonical property purpose' });
    const view = await interviews.get(owner, project.id);
    expect(view.propertyTypeMismatch).toEqual({ approved: true, draft: false });
    expect(view.completeness?.complete).toBe(false);
    expect(view.approvedRequirements?.buildingIntent?.value.kind).toBe('RESIDENTIAL');
    expect((await projects.version(owner, project.id, updated.versionId)).snapshot.requirements).toEqual(original.snapshot.requirements);
    const reopened = await interviews.start(owner, project.id, { expectedRevision: 3 });
    expect(reopened.propertyTypeMismatch).toEqual({ approved: true, draft: false });
    expect(reopened.interview?.candidate.requirements.buildingIntent?.value.kind).toBe('MIXED_USE');
    expect(reopened.interview?.candidate.requirements.spaces).toEqual(original.snapshot.requirements?.spaces);
    expect((await projects.version(owner, project.id, approved.versionId))).toEqual(original);
    expect((await pool.query('SELECT candidate,status FROM requirements_interviews WHERE id=$1', [approved.interview!.id])).rows[0]).toEqual(originalInterview);
    await expect(interviews.approve(owner, project.id, { expectedRevision: 3 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await projects.update(owner, project.id, { expectedRevision: 3, propertyType: 'COMMERCIAL', changeReason: 'Reconsider the planned property type' });
    expect((await interviews.get(owner, project.id)).propertyTypeMismatch.draft).toBe(true);
    await expect(interviews.approve(owner, project.id, { expectedRevision: 4 })).rejects.toMatchObject({ code: 'CONFLICT' });
    const fresh = await interviews.start(owner, project.id, { expectedRevision: 4 });
    expect(fresh.interview?.id).not.toBe(reopened.interview?.id);
    expect(fresh.interview?.candidate.requirements.buildingIntent?.value.kind).toBe('COMMERCIAL');
  });
  it('derives known context for pre-correction drafts with null intent without changing stored data on read', async () => {
    const project = await projects.create(owner, { name: 'Historical incomplete draft', propertyType: 'COMMERCIAL' });
    const started = await interviews.start(owner, project.id, { expectedRevision: 1 });
    const candidate = structuredClone(started.interview!.candidate);
    candidate.requirements.buildingIntent = null;
    candidate.questions = ['What kind of building do you want?'];
    await pool.query('UPDATE requirements_interviews SET candidate=$2 WHERE id=$1', [started.interview!.id, candidate]);
    const view = await interviews.get(owner, project.id);
    expect(view.interview?.candidate.requirements.buildingIntent?.value.kind).toBe('COMMERCIAL');
    expect(view.interview?.candidate.questions).not.toContain('What kind of building do you want?');
    expect((await pool.query('SELECT candidate FROM requirements_interviews WHERE id=$1', [started.interview!.id])).rows[0].candidate).toEqual(candidate);
    const saved = await interviews.editBrief(owner, project.id, { expectedRevision: 1, changeReason: 'Save the known project context', requirements: view.interview!.candidate.requirements });
    expect(saved.interview?.candidate.requirements.buildingIntent?.provenance.current.kind).toBe('PROJECT_CONTEXT');
    expect(saved.interview?.candidate.questions).not.toContain('What kind of building do you want?');
  });
  it('prevents manual or AI changes from creating a competing property type', async () => {
    const project = await projects.create(owner, { name: 'Commercial canonical context', propertyType: 'COMMERCIAL' });
    const started = await interviews.start(owner, project.id, { expectedRevision: 1 });
    const requirements = structuredClone(started.interview!.candidate.requirements);
    requirements.buildingIntent!.value.kind = 'RESIDENTIAL';
    await expect(interviews.editBrief(owner, project.id, { expectedRevision: 1, changeReason: 'Try a conflicting type', requirements })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const reply = await interviews.sendMessage(owner, project.id, { expectedRevision: 1, content: 'Actually a residential home with G+1, 3 bedrooms, owner only.' });
    expect(reply.interview?.candidate.requirements.buildingIntent?.value.kind).toBe('COMMERCIAL');
    expect(reply.interview?.messages.at(-1)?.content).toContain('Project Details');
    expect((await projects.get(owner, project.id)).propertyType).toBe('COMMERCIAL');
  });
});
