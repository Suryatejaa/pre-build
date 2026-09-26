import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createProjectUnitOfWork, createRequirementsUnitOfWork } from '@property/database';
import { migrate } from '@property/database/migrate';
import type { Principal } from '@property/domain';
import { AiProviderError, AiProviderRouter, FakeRequirementsAiProvider, ProjectService, RequirementsInterviewService, type RequirementsAiProvider, type RequirementsRepository, type RequirementsUnitOfWork } from '@property/services';
import { richExtraction, richOwnerMessage } from './requirements-rich-fixture';
import { rectangleFacts } from './site-fixtures';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !new URL(connectionString).pathname.endsWith('_test')) throw new Error('An isolated TEST_DATABASE_URL ending in _test is required.');
const schema = `test_requirements_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString });
const pool = new Pool({ connectionString, options: `-c search_path=${schema},public`, max: 8 });
const projects = new ProjectService(createProjectUnitOfWork(pool), randomUUID, () => new Date());
const owner: Principal = { userId: randomUUID() };
const stranger: Principal = { userId: randomUUID() };
const contractor: Principal = { userId: randomUUID() };
let providerFails = false;
const fake = new FakeRequirementsAiProvider();
const provider: RequirementsAiProvider = {
  metadata: fake.metadata,
  async generateStructured(request) { if (providerFails) throw new Error('provider credential or payload must not be logged'); return fake.generateStructured(request); },
  generateText: request => fake.generateText(request),
};
const interviews = new RequirementsInterviewService(createRequirementsUnitOfWork(pool), new AiProviderRouter([provider]), randomUUID, () => new Date());
async function addUser(actor: Principal, label: string) {
  await pool.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)', [actor.userId, label, `${actor.userId}@example.test`]);
}
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
  await Promise.all([addUser(owner, 'Requirements owner'), addUser(stranger, 'Requirements stranger'), addUser(contractor, 'Requirements contractor')]);
});
afterAll(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });

describe('PostgreSQL Property Requirements workflows', () => {
  it('uses canonical Site context, saves a validated candidate, preserves manual provenance, and approves an immutable V3 version', async () => {
    const project = await projects.create(owner, { name: 'Requirements approval house' });
    const site = rectangleFacts(); site.orientation.facing = 'E';
    const savedSite = await projects.saveSite(owner, project.id, { expectedRevision: 1, changeReason: 'Record the owner supplied Site details', site });
    const started = await interviews.start(owner, project.id, { expectedRevision: savedSite.revision });
    expect(started.status).toBe('IN_PROGRESS');
    expect(started.siteContext?.orientation.facing).toBe('E');
    expect(started.interview?.candidate.requirements).not.toHaveProperty('site');

    const reviewed = await interviews.sendMessage(owner, project.id, { expectedRevision: savedSite.revision, content: 'I want a residential home with G+1, 3 bedrooms and owner only.' });
    expect(reviewed.status).toBe('REVIEW_REQUIRED');
    expect(reviewed.interview?.candidate.requirements.buildingScale.floorCount.value.exact).toBe(2);
    expect(reviewed.interview?.candidate.requirements.spaces[0]?.count.exact).toBe(3);

    const corrected = structuredClone(reviewed.interview!.candidate.requirements);
    corrected.spaces[0]!.priority = 'MUST_HAVE';
    const edited = await interviews.editBrief(owner, project.id, { expectedRevision: savedSite.revision, changeReason: 'Make bedroom count a must-have', requirements: corrected });
    expect(edited.interview?.candidate.requirements.spaces[0]?.provenance.current.kind).toBe('MANUALLY_EDITED');
    expect(edited.interview?.candidate.requirements.spaces[0]?.provenance.history[0]?.kind).toBe('DIRECTLY_STATED');
    const requirementsUow = createRequirementsUnitOfWork(pool);
    const brokenUow: RequirementsUnitOfWork = { read: requirementsUow.read, transaction: work => requirementsUow.transaction(repo => work(new Proxy(repo, {
      get(target, property) {
        if (property === 'audit') return async () => { throw new Error('Simulated approval audit failure'); };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as RequirementsRepository)) };
    const brokenService = new RequirementsInterviewService(brokenUow, new AiProviderRouter([provider]), randomUUID, () => new Date());
    await expect(brokenService.approve(owner, project.id, { expectedRevision: savedSite.revision })).rejects.toThrow('Simulated approval audit failure');
    await expect(pool.query('SELECT current_revision FROM property_projects WHERE id=$1', [project.id])).resolves.toMatchObject({ rows: [{ current_revision: savedSite.revision }] });
    expect((await interviews.get(owner, project.id)).status).toBe('REVIEW_REQUIRED');
    const approved = await interviews.approve(owner, project.id, { expectedRevision: savedSite.revision });
    expect(approved.projectRevision).toBe(savedSite.revision + 1);
    expect(approved.status).toBe('APPROVED');
    expect(approved.interview?.approvedProjectVersionId).toBe(approved.versionId);
    expect((await projects.version(owner, project.id, project.versionId)).snapshot.schemaVersion).toBe(1);
    const version = await projects.version(owner, project.id, approved.versionId);
    expect(version.snapshot.schemaVersion).toBe(3);
    if (version.snapshot.schemaVersion === 3) expect(version.snapshot.requirements?.spaces[0]?.priority).toBe('MUST_HAVE');
    expect(version.source).toBe('AI');
    const audit = await pool.query('SELECT action,source FROM audit_events WHERE project_id=$1 ORDER BY occurred_at', [project.id]);
    expect(audit.rows.map(row => row.action)).toContain('REQUIREMENTS_APPROVED');
    expect((await pool.query('SELECT succeeded,input_tokens,output_tokens FROM requirements_ai_requests WHERE interview_id=$1', [approved.interview!.id])).rows).toMatchObject([{ succeeded: true, input_tokens: expect.any(Number), output_tokens: expect.any(Number) }]);
    await expect(interviews.get(owner, project.id)).resolves.toMatchObject({ status: 'APPROVED', projectRevision: approved.projectRevision });
  });

  it('surfaces changed counts and Site discrepancies, blocks approval, and creates a controlled follow-up revision', async () => {
    const project = await projects.create(owner, { name: 'Conflicting requirements house' });
    const siteFacts = rectangleFacts(); siteFacts.orientation.facing = 'E';
    const site = await projects.saveSite(owner, project.id, { expectedRevision: 1, changeReason: 'Add a recorded East facing Site', site: siteFacts });
    await interviews.start(owner, project.id, { expectedRevision: site.revision });
    const discrepancy = await interviews.sendMessage(owner, project.id, { expectedRevision: site.revision, content: 'North-facing residential home, G+1, 3 bedrooms, owner only.' });
    expect(discrepancy.interview?.candidate.siteDiscrepancies[0]).toMatchObject({ field: 'facing', savedValue: 'E', statedValue: 'NORTH', status: 'OPEN' });
    expect((await projects.site(owner, project.id)).site?.facts.orientation.facing).toBe('E');
    await expect(interviews.approve(owner, project.id, { expectedRevision: site.revision })).rejects.toMatchObject({ code: 'CONFLICT' });
    const reconciled = await interviews.resolveSiteDiscrepancy(owner, project.id, { expectedRevision: site.revision, discrepancyId: discrepancy.interview!.candidate.siteDiscrepancies[0]!.id, resolution: 'Keep the saved Site record as the source of truth.' });
    expect(reconciled.status).toBe('REVIEW_REQUIRED');
    const firstApproval = await interviews.approve(owner, project.id, { expectedRevision: site.revision });
    const originalRequirementsVersion = await projects.version(owner, project.id, firstApproval.versionId);
    const reopened = await interviews.start(owner, project.id, { expectedRevision: firstApproval.projectRevision });
    expect(reopened.interview?.candidate.requirements.spaces[0]?.count.exact).toBe(3);
    const changed = await interviews.sendMessage(owner, project.id, { expectedRevision: firstApproval.projectRevision, content: 'Also, the house should be G+2 and 4 bedrooms.' });
    const openConflicts = changed.interview!.candidate.conflicts.filter(item => item.status === 'OPEN');
    expect(openConflicts.map(item => item.kind)).toEqual(expect.arrayContaining(['FLOOR_COUNT_CHANGED', 'SPACE_COUNT_CHANGED']));
    await expect(interviews.approve(owner, project.id, { expectedRevision: firstApproval.projectRevision })).rejects.toMatchObject({ code: 'CONFLICT' });
    let resolved = changed;
    for (const conflict of openConflicts) resolved = await interviews.resolveConflict(owner, project.id, { expectedRevision: firstApproval.projectRevision, conflictId: conflict.id, resolution: 'Use the latest values stated by the owner.' });
    expect(resolved.status).toBe('REVIEW_REQUIRED');
    const secondApproval = await interviews.approve(owner, project.id, { expectedRevision: firstApproval.projectRevision });
    expect(secondApproval.projectRevision).toBe(firstApproval.projectRevision + 1);
    expect((await projects.version(owner, project.id, firstApproval.versionId)).snapshot).toEqual(originalRequirementsVersion.snapshot);
  });

  it('stores owner messages across AI failure, allows retry, and enforces owner-only access', async () => {
    const project = await projects.create(owner, { name: 'Recoverable AI interview' });
    const started = await interviews.start(owner, project.id, { expectedRevision: 1 });
    await projects.assignMember(owner, project.id, { userId: contractor.userId, role: 'CONTRACTOR_CONTRIBUTOR' });
    await expect(interviews.get(stranger, project.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(interviews.get(contractor, project.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(interviews.editBrief(contractor, project.id, { expectedRevision: 1, changeReason: 'Unauthorized contractor edit', requirements: started.interview!.candidate.requirements })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    providerFails = true;
    await expect(interviews.sendMessage(owner, project.id, { expectedRevision: 1, content: 'I want a home with 3 bedrooms.' })).rejects.toMatchObject({ code: 'AI_PROVIDER_FAILED' });
    let persisted = await interviews.get(owner, project.id);
    expect(persisted.interview?.messages.filter(message => message.role === 'OWNER')).toHaveLength(1);
    expect(persisted.interview?.candidate.lastAiError).toBe('AI_PROVIDER_FAILED');
    const failureLog = await pool.query('SELECT succeeded,retry_count FROM requirements_ai_requests WHERE interview_id=$1', [started.interview!.id]);
    expect(failureLog.rows).toMatchObject([{ succeeded: false, retry_count: 0 }]);
    providerFails = false;
    persisted = await interviews.retry(owner, project.id, { expectedRevision: 1 });
    expect(persisted.interview?.messages.filter(message => message.role === 'OWNER')).toHaveLength(1);
    expect(persisted.interview?.messages.filter(message => message.role === 'ASSISTANT')).toHaveLength(2);
    expect(persisted.interview?.candidate.lastAiError).toBeNull();
    const usageRows = await pool.query('SELECT succeeded FROM requirements_ai_requests WHERE interview_id=$1 ORDER BY occurred_at', [started.interview!.id]);
    expect(usageRows.rows.map(row => row.succeeded)).toEqual([false, true]);
  });

  it('rejects stale project revisions and incomplete approval', async () => {
    const project = await projects.create(owner, { name: 'Incomplete brief house' });
    const started = await interviews.start(owner, project.id, { expectedRevision: 1 });
    await expect(interviews.approve(owner, project.id, { expectedRevision: 1 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await interviews.sendMessage(owner, project.id, { expectedRevision: 1, content: 'I want a home with G+1, 3 bedrooms and owner only.' });
    await projects.update(owner, project.id, { expectedRevision: 1, name: 'Renamed house', changeReason: 'Rename before requirements approval' });
    await expect(interviews.sendMessage(owner, project.id, { expectedRevision: 1, content: 'Three bedrooms' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(interviews.approve(owner, project.id, { expectedRevision: 2 })).rejects.toMatchObject({ code: 'CONFLICT' });
    const fresh = await interviews.start(owner, project.id, { expectedRevision: 2 });
    expect(fresh.status).toBe('REVIEW_REQUIRED');
    expect(fresh.interview?.id).not.toBe(started.interview?.id);
    expect(fresh.interview?.candidate.requirements.spaces[0]?.count.exact).toBe(3);
    await expect(pool.query('SELECT status FROM requirements_interviews WHERE id=$1', [started.interview!.id])).resolves.toMatchObject({ rows: [{ status: 'SUPERSEDED' }] });
  });

  it('rechecks current contradictions at approval even after a conflict is acknowledged', async () => {
    const project = await projects.create(owner, { name: 'Contradiction guard house' });
    await interviews.start(owner, project.id, { expectedRevision: 1 });
    const extracted = await interviews.sendMessage(owner, project.id, { expectedRevision: 1, content: 'I want a residential home with G+1, 3 bedrooms, and owner only.' });
    const contradictory = structuredClone(extracted.interview!.candidate.requirements);
    contradictory.spaces[0]!.count.maximum = 2;
    const edited = await interviews.editBrief(owner, project.id, { expectedRevision: 1, changeReason: 'Check contradictory bedroom counts', requirements: contradictory });
    const conflict = edited.interview!.candidate.conflicts.find(item => item.kind === 'COUNT_RANGE_CONFLICT')!;
    await interviews.resolveConflict(owner, project.id, { expectedRevision: 1, conflictId: conflict.id, resolution: 'Owner confirms the current brief values.' });
    await expect(interviews.approve(owner, project.id, { expectedRevision: 1 })).rejects.toMatchObject({ code: 'CONFLICT' });

    const corrected = structuredClone(contradictory);
    delete corrected.spaces[0]!.count.maximum;
    const valid = await interviews.editBrief(owner, project.id, { expectedRevision: 1, changeReason: 'Remove the conflicting maximum', requirements: corrected });
    expect(valid.interview?.candidate.conflicts.find(item => item.id === conflict.id)?.status).toBe('RESOLVED');
    await expect(interviews.approve(owner, project.id, { expectedRevision: 1 })).resolves.toMatchObject({ status: 'APPROVED' });
  });

  it('repairs malformed structured output once and persists the bounded retry count', async () => {
    const project = await projects.create(owner, { name: 'Structured repair house' });
    let calls = 0;
    const repairing: RequirementsAiProvider = {
      metadata: { provider: 'fake-repair', model: 'structured-v1' },
      async generateStructured(request) {
        calls += 1;
        if (calls === 1) return { output: { assistantMessage: 'malformed' }, usage: { inputTokens: 4, outputTokens: 2 } };
        return fake.generateStructured(request);
      },
      generateText: request => fake.generateText(request),
    };
    const service = new RequirementsInterviewService(createRequirementsUnitOfWork(pool), new AiProviderRouter([repairing]), randomUUID, () => new Date());
    const started = await service.start(owner, project.id, { expectedRevision: 1 });
    const response = await service.sendMessage(owner, project.id, { expectedRevision: 1, content: 'I want a house with 2 bedrooms.' });
    expect(calls).toBe(2);
    expect(response.interview?.candidate.lastAiError).toBeNull();
    await expect(pool.query('SELECT retry_count,succeeded FROM requirements_ai_requests WHERE interview_id=$1', [started.interview!.id])).resolves.toMatchObject({ rows: [{ retry_count: 1, succeeded: true }] });
  });

  it('keeps manual completion available when no provider is configured', async () => {
    const project = await projects.create(owner, { name: 'Manual requirements house' });
    const manual = new RequirementsInterviewService(createRequirementsUnitOfWork(pool), null, randomUUID, () => new Date());
    await manual.start(owner, project.id, { expectedRevision: 1 });
    await expect(manual.sendMessage(owner, project.id, { expectedRevision: 1, content: 'I need a simple home.' })).rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    const saved = await manual.get(owner, project.id);
    expect(saved.aiAvailability).toBe('NOT_CONFIGURED');
    expect(saved.interview?.messages.some(message => message.role === 'OWNER')).toBe(true);
    const requirements = structuredClone(saved.interview!.candidate.requirements);
    const stamp = { current: { kind: 'MANUALLY_EDITED' as const, sourceMessageId: null, actorId: owner.userId, confidence: null }, history: [] };
    requirements.buildingIntent = { value: { kind: 'RESIDENTIAL', otherDescription: null }, provenance: stamp };
    requirements.buildingScale.floorCount = { value: { exact: 1 }, priority: 'PREFERRED', provenance: stamp };
    requirements.spaces.push({ id: randomUUID(), type: 'BEDROOM', customName: null, count: { exact: 1 }, floor: { kind: 'UNSPECIFIED' }, size: { kind: 'NO_PREFERENCE' }, priority: 'PREFERRED', provenance: stamp });
    requirements.rental.mode = { value: 'OWNER_ONLY', provenance: stamp };
    const reviewed = await manual.editBrief(owner, project.id, { expectedRevision: 1, changeReason: 'Complete brief without AI', requirements });
    expect(reviewed.status).toBe('REVIEW_REQUIRED');
    const approved = await manual.approve(owner, project.id, { expectedRevision: 1 });
    expect(approved.status).toBe('APPROVED');
    expect((await projects.version(owner, project.id, approved.versionId)).source).toBe('HUMAN');
  });

  it('persists the actual fallback provider and every attempt without changing project snapshots', async () => {
    const project = await projects.create(owner, { name: 'Provider fallback verification' });
    const fallback: RequirementsAiProvider = { ...provider, metadata: { provider: 'fallback-b', model: 'test-fallback-model' } };
    const unavailable = (name: string): RequirementsAiProvider => ({ ...provider, metadata: { provider: name, model: 'test-model' },
      async generateStructured() { throw new AiProviderError('RATE_LIMIT'); } });
    const service = new RequirementsInterviewService(createRequirementsUnitOfWork(pool), new AiProviderRouter([unavailable('sarvam'), unavailable('fallback-a'), fallback]), randomUUID, () => new Date());
    const started = await service.start(owner, project.id, { expectedRevision: 1 });
    expect(started.aiAvailability).toBe('AVAILABLE');
    const result = await service.sendMessage(owner, project.id, { expectedRevision: 1, content: 'I need 3 bedrooms.' });
    expect(result.interview!.messages.at(-1)).toMatchObject({ provider: 'fallback-b', model: 'test-fallback-model' });
    expect(result.interview!.candidate.requirements.spaces[0]?.count).toEqual({ exact: 3 });
    const row = (await pool.query('SELECT * FROM requirements_ai_requests WHERE interview_id=$1', [started.interview!.id])).rows[0];
    expect(row).toMatchObject({ succeeded: true, provider: 'fallback-b', model: 'test-fallback-model', routing_outcome: 'FALLBACK_USED', retry_count: 0,
      attempts: [{ provider: 'sarvam', errorCode: 'RATE_LIMIT' }, { provider: 'fallback-a', errorCode: 'RATE_LIMIT' }, { provider: 'fallback-b', succeeded: true, errorCode: null }] });
    expect(row.attempts.every((attempt: { occurredAt: string; latencyMs: number }) => Boolean(attempt.occurredAt) && attempt.latencyMs >= 0)).toBe(true);
    expect((await projects.get(owner, project.id)).revision).toBe(1);
    await expect(pool.query("UPDATE requirements_ai_requests SET attempts='[]'::jsonb WHERE id=$1", [row.id])).rejects.toThrow();
  });

  it('keeps the owner message and candidate recoverable when every configured provider fails', async () => {
    const project = await projects.create(owner, { name: 'All providers unavailable' });
    const failed = (name: string): RequirementsAiProvider => ({ ...provider, metadata: { provider: name, model: 'test-model' },
      async generateStructured() { throw new AiProviderError('TIMEOUT'); } });
    const service = new RequirementsInterviewService(createRequirementsUnitOfWork(pool), new AiProviderRouter([failed('sarvam'), failed('fallback-a'), failed('fallback-b')]), randomUUID, () => new Date());
    const started = await service.start(owner, project.id, { expectedRevision: 1 });
    await expect(service.sendMessage(owner, project.id, { expectedRevision: 1, content: 'I need three bedrooms.' })).rejects.toMatchObject({ code: 'AI_PROVIDER_FAILED' });
    const saved = await service.get(owner, project.id);
    expect(saved.interview!.candidate.requirements).toEqual(started.interview!.candidate.requirements);
    expect(saved.interview!.messages.at(-1)?.content).toBe('I need three bedrooms.');
    expect(saved.interview!.candidate.lastAiError).toBe('AI_PROVIDER_FAILED');
    expect(saved.status).toBe('IN_PROGRESS');
    expect((await pool.query('SELECT routing_outcome,attempts FROM requirements_ai_requests WHERE interview_id=$1', [started.interview!.id])).rows[0]).toMatchObject({ routing_outcome: 'ALL_PROVIDERS_FAILED', attempts: [{ errorCode: 'TIMEOUT' }, { errorCode: 'TIMEOUT' }, { errorCode: 'TIMEOUT' }] });
    const edited = await service.editBrief(owner, project.id, { expectedRevision: 1, changeReason: 'Keep manual review available', requirements: saved.interview!.candidate.requirements });
    expect(edited.interview!.candidate.lastAiError).toBeNull();
  });

  it('rejects spoofed output after bounded repairs and never persists it as candidate or assistant text', async () => {
    const project = await projects.create(owner, { name: 'Spoofed response verification' });
    let calls = 0;
    const spoofed: RequirementsAiProvider = { ...provider, async generateStructured() {
      calls++; return { output: { assistantMessage: 'secret raw response', extractions: [], followUpQuestions: [], siteClaims: [], explicitCorrection: false, snapshot: { site: 'spoofed' } } };
    } };
    const service = new RequirementsInterviewService(createRequirementsUnitOfWork(pool), new AiProviderRouter([spoofed]), randomUUID, () => new Date());
    const started = await service.start(owner, project.id, { expectedRevision: 1 });
    await expect(service.sendMessage(owner, project.id, { expectedRevision: 1, content: 'Three bedrooms.' })).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' });
    expect(calls).toBe(2);
    const saved = await service.get(owner, project.id);
    expect(saved.interview!.candidate.requirements).toEqual(started.interview!.candidate.requirements);
    expect(JSON.stringify(saved)).not.toMatch(/secret raw response|spoofed/);
    expect((await projects.get(owner, project.id)).revision).toBe(1);
    const row = (await pool.query('SELECT * FROM requirements_ai_requests WHERE interview_id=$1', [started.interview!.id])).rows[0];
    expect(row).toMatchObject({ succeeded: false, retry_count: 1, routing_outcome: 'ALL_PROVIDERS_FAILED' });
    expect(JSON.stringify(row)).not.toMatch(/secret raw response|snapshot/);
  });

  it('merges the exact rich message by floor, preserves facts without cosmetic prose, and asks a small deterministic batch', async () => {
    const project = await projects.create(owner, { name: 'Rich message regression' });
    const text = vi.fn(async () => { throw new Error('Cosmetic generation must never be called'); });
    const richProvider: RequirementsAiProvider = { metadata: { provider: 'test-rich', model: 'deterministic' },
      generateStructured: vi.fn(async request => {
        expect((request.input as { ownerMessage: string }).ownerMessage).toBe(richOwnerMessage);
        return { output: { ...richExtraction, assistantMessage: null } };
      }), generateText: text };
    const service = new RequirementsInterviewService(createRequirementsUnitOfWork(pool), new AiProviderRouter([richProvider]), randomUUID, () => new Date());
    const started = await service.start(owner, project.id, { expectedRevision: 1 });
    expect(started.interview!.candidate.questions).toHaveLength(2);
    const updated = await service.sendMessage(owner, project.id, { expectedRevision: 1, content: richOwnerMessage });
    const brief = updated.interview!.candidate.requirements;
    expect(brief.buildingScale.floorCount.value).toEqual({ exact: 3 });
    expect(brief.spaces.map(space => [space.type, space.count.exact, 'label' in space.floor ? space.floor.label : null, space.customName])).toEqual([
      ['PARKING', 1, 'Ground floor', null], ['LIVING_ROOM', 1, 'Ground floor', null],
      ['KITCHEN', 1, 'Ground floor', null], ['DINING', 1, 'Ground floor', null],
      ['BEDROOM', 1, 'Ground floor', 'Bedroom for parents'], ['BEDROOM', 3, 'First floor', null],
      ['FAMILY_LOUNGE', 1, 'First floor', null], ['HOME_OFFICE', 1, 'Second floor', null],
      ['TERRACE', 1, 'Second floor', 'Open terrace'],
    ]);
    expect(brief.spaces.filter(space => space.type === 'BEDROOM').map(space => [space.count.exact, space.floor])).toEqual([[1, { kind: 'SPECIFIC_FLOOR', label: 'Ground floor' }], [3, { kind: 'SPECIFIC_FLOOR', label: 'First floor' }]]);
    expect(brief.spaces.find(space => space.type === 'BEDROOM')?.customName).toBe('Bedroom for parents');
    expect(brief.parking[0]).toMatchObject({ vehicle: 'CAR', count: { exact: 2 }, cover: null, evCharging: null });
    expect(brief.futureExpansion[0]).toMatchObject({ kind: 'LIFT_PROVISION', priority: 'OPTIONAL' });
    expect(brief.buildingScale.lift).toBeNull();
    expect(brief.vaasthuPreference?.value).toBe('STRONG');
    expect(brief.occupancy.elderlyOccupants).toBeNull();
    expect(brief.rental.mode).toBeNull();
    expect(updated.interview!.candidate.conflicts).toEqual([]);
    expect(updated.interview!.candidate.questions).toEqual(['Will this be owner-only, or include a rental unit or floor?']);
    expect(text).not.toHaveBeenCalled();
    const trace = (await pool.query('SELECT attempts FROM requirements_ai_requests WHERE interview_id=$1', [started.interview!.id])).rows[0].attempts[0];
    expect(trace.pipeline).toContainEqual({ stage: 'ASSISTANT_TEXT', outcome: 'RECOVERED' });
    expect(trace.pipeline).toContainEqual({ stage: 'PERSISTENCE', outcome: 'PASSED' });
    expect((await projects.get(owner, project.id)).revision).toBe(1);
  });

  it('keeps identically named bedrooms distinct across floors, retries, and subsequent floor-specific updates', async () => {
    const project = await projects.create(owner, { name: 'Floor-scoped rooms' });
    const extraction = structuredClone(richExtraction);
    for (const fact of extraction.extractions) if (fact.category === 'SPACE' && fact.type === 'BEDROOM') fact.customName = null;
    const richProvider: RequirementsAiProvider = { ...provider, async generateStructured() { return { output: extraction }; } };
    const service = new RequirementsInterviewService(createRequirementsUnitOfWork(pool), new AiProviderRouter([richProvider]), randomUUID, () => new Date());
    await service.start(owner, project.id, { expectedRevision: 1 });
    const first = await service.sendMessage(owner, project.id, { expectedRevision: 1, content: richOwnerMessage });
    const second = await service.retry(owner, project.id, { expectedRevision: 1 });
    expect(first.interview!.candidate.requirements.spaces.filter(space => space.type === 'BEDROOM')).toHaveLength(2);
    expect(second.interview!.candidate.requirements.spaces.map(space => space.id)).toEqual(first.interview!.candidate.requirements.spaces.map(space => space.id));
    const firstFloor = extraction.extractions.find(fact => fact.category === 'SPACE' && fact.type === 'BEDROOM' && 'label' in fact.floor && fact.floor.label === 'First floor')!;
    if (firstFloor.category !== 'SPACE') throw new Error('Expected first-floor bedroom fixture');
    extraction.extractions = [{ ...firstFloor, count: { exact: 4 } }];
    extraction.explicitCorrection = true;
    const third = await service.sendMessage(owner, project.id, { expectedRevision: 1, content: 'Actually, change only the first floor to 4 bedrooms.' });
    const before = second.interview!.candidate.requirements.spaces;
    const after = third.interview!.candidate.requirements.spaces;
    expect(after.map(space => space.id)).toEqual(before.map(space => space.id));
    expect(after.filter(space => space.type === 'BEDROOM').map(space => [space.floor, space.count.exact])).toEqual([
      [{ kind: 'SPECIFIC_FLOOR', label: 'Ground floor' }, 1], [{ kind: 'SPECIFIC_FLOOR', label: 'First floor' }, 4],
    ]);
    const changedId = before.find(space => space.type === 'BEDROOM' && 'label' in space.floor && space.floor.label === 'First floor')!.id;
    expect(after.filter(space => space.id !== changedId)).toEqual(before.filter(space => space.id !== changedId));

  });

  it('classifies domain-validation failure without falling back and preserves the previous candidate', async () => {
    const project = await projects.create(owner, { name: 'Invalid extracted domain value' });
    const fallback = { ...provider, metadata: { provider: 'fallback', model: 'test' }, generateStructured: vi.fn(provider.generateStructured) };
    const invalid: RequirementsAiProvider = { ...provider, async generateStructured() { return { output: { ...richExtraction, extractions: [{ category: 'FLOOR_COUNT', count: { exact: 0 }, priority: 'PREFERRED', evidence: 'DIRECTLY_STATED', confidence: 'HIGH' }] } }; } };
    const service = new RequirementsInterviewService(createRequirementsUnitOfWork(pool), new AiProviderRouter([invalid, fallback]), randomUUID, () => new Date());
    const started = await service.start(owner, project.id, { expectedRevision: 1 });
    await expect(service.sendMessage(owner, project.id, { expectedRevision: 1, content: richOwnerMessage })).rejects.toMatchObject({ code: 'AI_INVALID_OUTPUT' });
    expect(fallback.generateStructured).not.toHaveBeenCalled();
    const saved = await service.get(owner, project.id);
    expect(saved.interview!.candidate.requirements).toEqual(started.interview!.candidate.requirements);
    const trace = (await pool.query('SELECT attempts FROM requirements_ai_requests WHERE interview_id=$1', [started.interview!.id])).rows[0].attempts[0];
    expect(trace.pipeline.at(-1)).toMatchObject({ stage: 'DOMAIN_VALIDATION', outcome: 'FAILED' });
  });

});
