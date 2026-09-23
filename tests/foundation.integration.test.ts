import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createProjectUnitOfWork, isDatabaseReady } from '@property/database';
import { migrate } from '@property/database/migrate';
import { ProjectService, type ProjectUnitOfWork } from '@property/services';
import { buildSite, type Principal } from '@property/domain';
import { rectangleFacts } from './site-fixtures';
import { createAuthentication } from '@property/infrastructure/auth';
import { readConfig } from '@property/infrastructure/config';
import { createProjectApi } from '../apps/web/src/server/project-api';
import { handleAuth } from '../apps/web/src/server/auth-http';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !new URL(connectionString).pathname.endsWith('_test')) {
  throw new Error('Integration tests require a separate TEST_DATABASE_URL whose database name ends in _test. Tests never fall back to DATABASE_URL.');
}
const schema = `test_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString });
const pool = new Pool({ connectionString, options: `-c search_path=${schema},public`, max: 8 });
const uow = createProjectUnitOfWork(pool);
const service = new ProjectService(uow, randomUUID, () => new Date());
const owner = { userId: randomUUID() };
const stranger = { userId: randomUUID() };
const contributor = { userId: randomUUID() };
const professional = { userId: randomUUID() };
const origin = 'http://localhost:3000';
let authentication: ReturnType<typeof createAuthentication>;
async function createUser(actor: Principal) {
  await pool.query('INSERT INTO "user"(id, name, email) VALUES ($1,$2,$3)', [actor.userId, 'Test owner', `${actor.userId}@example.test`]);
}
beforeAll(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
  await Promise.all([owner, stranger, contributor, professional].map(createUser));
  authentication = createAuthentication(pool, readConfig({ DATABASE_URL: connectionString, BETTER_AUTH_SECRET: 'test-only-secret-with-more-than-32-characters', APP_URL: origin, NODE_ENV: 'test' }));
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

describe('PostgreSQL project workflows', () => {
  it('creates ownership, canonical version, and audit together; persists across service instances', async () => {
    const project = await service.create(owner, { name: 'Our first home' });
    const anotherService = new ProjectService(createProjectUnitOfWork(pool), randomUUID, () => new Date());
    expect(await anotherService.get(owner, project.id)).toEqual(project);
    const first = await service.version(owner, project.id, project.versionId);
    expect(first.snapshot).toEqual({ schemaVersion: 1, projectId: project.id, name: 'Our first home', propertyType: 'RESIDENTIAL_HOUSE', status: 'ACTIVE' });
    expect(first.createdBy).toBe(owner.userId);
    expect(await service.members(owner, project.id)).toEqual([expect.objectContaining({ userId: owner.userId, role: 'OWNER' })]);
    const audit = await pool.query('SELECT * FROM audit_events WHERE project_id=$1', [project.id]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ actor_id: owner.userId, project_version_id: first.id, source: 'HUMAN' });
  });
  it('never lists or reads another owner’s project', async () => {
    const project = await service.create(owner, { name: 'Private house' });
    expect((await service.list(stranger)).items.some(item => item.id === project.id)).toBe(false);
    await expect(service.get(stranger, project.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.get(stranger, randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.versions(stranger, project.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('creates new snapshots without changing history, and safely archives/restores', async () => {
    const project = await service.create(owner, { name: 'Original name' });
    const updated = await service.update(owner, project.id, { name: 'Updated name', expectedRevision: 1, changeReason: 'Owner renamed the property' });
    expect(updated.revision).toBe(2);
    expect((await service.version(owner, project.id, project.versionId)).snapshot.name).toBe('Original name');
    const archived = await service.update(owner, project.id, { status: 'ARCHIVED', expectedRevision: 2, changeReason: 'Planning temporarily paused' });
    expect(archived.status).toBe('ARCHIVED');
    const restored = await service.update(owner, project.id, { status: 'ACTIVE', expectedRevision: 3, changeReason: 'Planning has resumed' });
    expect(restored.revision).toBe(4);
    expect(restored.id).toBe(project.id);
    expect((await service.versions(owner, project.id)).items).toHaveLength(4);
    const noop = await service.update(owner, project.id, { status: 'ACTIVE', expectedRevision: 4, changeReason: 'No status change required' });
    expect(noop.revision).toBe(4);
  });
  it('rejects stale and concurrent writes without losing updates', async () => {
    const project = await service.create(owner, { name: 'Concurrent house' });
    const results = await Promise.allSettled(['First update', 'Second update'].map(name => service.update(owner, project.id, { name, expectedRevision: 1, changeReason: 'Concurrent edit test' })));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find(result => result.status === 'rejected');
    expect(failed?.status === 'rejected' && failed.reason.code).toBe('CONFLICT');
    expect((await service.versions(owner, project.id)).items).toHaveLength(2);
    await expect(service.update(owner, project.id, { name: 'Stale update', expectedRevision: 1, changeReason: 'Stale browser state' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('rolls back project and version creation if the audit write fails', async () => {
    const broken: ProjectUnitOfWork = { read: uow.read, transaction: work => uow.transaction(repo => work(new Proxy(repo, {
      get(target, property) { if (property === 'audit') return async () => { throw new Error('Audit storage failure'); }; const member = Reflect.get(target, property); return typeof member === 'function' ? member.bind(target) : member; },
    }))) };
    const before = await pool.query('SELECT count(*)::int AS count FROM property_projects');
    await expect(new ProjectService(broken, randomUUID, () => new Date()).create(owner, { name: 'Should roll back' })).rejects.toThrow('Audit storage failure');
    const after = await pool.query('SELECT count(*)::int AS count FROM property_projects');
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });
  it('enforces role permissions and immediate project-scoped revocation', async () => {
    const first = await service.create(owner, { name: 'Shared house' });
    const second = await service.create(owner, { name: 'Unshared house' });
    await service.assignMember(owner, first.id, { userId: contributor.userId, role: 'CONTRACTOR_CONTRIBUTOR' });
    expect((await service.get(contributor, first.id)).role).toBe('CONTRACTOR_CONTRIBUTOR');
    await expect(service.get(contributor, second.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.versions(contributor, first.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.members(contributor, first.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.update(contributor, first.id, { name: 'Not permitted', expectedRevision: 1, changeReason: 'Attempted unauthorized change' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(service.assignMember(contributor, first.id, { userId: stranger.userId, role: 'PROFESSIONAL' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await service.assignMember(owner, first.id, { userId: professional.userId, role: 'PROFESSIONAL' });
    expect((await service.versions(professional, first.id)).items).toHaveLength(1);
    await expect(service.assignMember(owner, first.id, { userId: owner.userId, role: 'PROFESSIONAL' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(service.removeMember(owner, first.id, owner.userId)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await service.removeMember(owner, first.id, contributor.userId);
    await expect(service.get(contributor, first.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('binds version reads to the correct project, even for the same owner', async () => {
    const first = await service.create(owner, { name: 'First house' });
    const second = await service.create(owner, { name: 'Second house' });
    await expect(service.version(owner, first.id, second.versionId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('audits role changes and rejects missing accounts without changing membership', async () => {
    const project = await service.create(owner, { name: 'Access audit house' });
    await service.assignMember(owner, project.id, { userId: contributor.userId, role: 'CONTRACTOR_VIEWER' });
    await service.assignMember(owner, project.id, { userId: contributor.userId, role: 'PROFESSIONAL' });
    await expect(service.assignMember(owner, project.id, { userId: randomUUID(), role: 'PROFESSIONAL' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await service.removeMember(owner, project.id, contributor.userId);
    const records = await pool.query('SELECT * FROM audit_events WHERE project_id=$1 ORDER BY occurred_at', [project.id]);
    expect(records.rows.map(row => row.action)).toEqual(['PROJECT_CREATED', 'MEMBER_ASSIGNED', 'MEMBER_ASSIGNED', 'MEMBER_REMOVED']);
    expect(records.rows[2]).toMatchObject({ before_data: { userId: contributor.userId, role: 'CONTRACTOR_VIEWER' }, after_data: { userId: contributor.userId, role: 'PROFESSIONAL' }, actor_id: owner.userId, project_version_id: project.versionId });
    expect((await service.versions(owner, project.id)).items).toHaveLength(1);
  });
  it('enforces immutable history, identity, owner uniqueness, and current-version foreign keys in SQL', async () => {
    const project = await service.create(owner, { name: 'Protected history' });
    await expect(pool.query('UPDATE project_versions SET change_reason=$1 WHERE id=$2', ['Changed history', project.versionId])).rejects.toThrow('append-only');
    await expect(pool.query('DELETE FROM project_versions WHERE id=$1', [project.versionId])).rejects.toThrow('append-only');
    await expect(pool.query('UPDATE audit_events SET action=$1 WHERE project_id=$2', ['PROJECT_UPDATED', project.id])).rejects.toThrow('append-only');
    await expect(pool.query('UPDATE property_projects SET owner_user_id=$1 WHERE id=$2', [stranger.userId, project.id])).rejects.toThrow('immutable');
    await expect(pool.query('UPDATE property_projects SET current_revision=2 WHERE id=$1', [project.id])).rejects.toThrow('foreign key');
    await expect(pool.query('INSERT INTO project_memberships(project_id,user_id,role,granted_by) VALUES ($1,$2,$3,$2)', [project.id, owner.userId, 'PROFESSIONAL'])).rejects.toThrow('derived');
  });
  it('paginates project lists and histories deterministically', async () => {
    const actor = { userId: randomUUID() }; await createUser(actor);
    for (let i = 0; i < 21; i++) await service.create(actor, { name: `House ${i}` });
    const first = await service.list(actor);
    const second = await service.list(actor, { page: first.nextPage });
    expect(first.items).toHaveLength(20); expect(second.items).toHaveLength(1); expect(second.nextPage).toBeNull();
    expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(21);
    const project = first.items[0]!;
    for (let revision = 1; revision <= 21; revision++) await service.update(actor, project.id, { name: `Revision ${revision + 1}`, expectedRevision: revision, changeReason: 'Revision pagination test' });
    expect((await service.versions(actor, project.id)).nextPage).toBe(2);
    expect((await service.versions(actor, project.id, { page: 2 })).items.map(item => item.revision)).toEqual([2, 1]);
  });
  it('applies migrations idempotently with tracked checksums', async () => {
    await migrate(pool);
    expect((await pool.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map(row => row.name)).toEqual(['001_foundation.sql', '002_site_intake.sql']);
  });
  it('reports readiness after the required migration has completed', async () => {
    expect(await isDatabaseReady(pool)).toBe(true);
  });
  it('does not report readiness for an empty or incomplete migration ledger', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM schema_migrations');
      expect(await isDatabaseReady(client)).toBe(false);
      await client.query('INSERT INTO schema_migrations(name, checksum) VALUES ($1, $2)', ['000_incomplete.sql', 'test-only']);
      expect(await isDatabaseReady(client)).toBe(false);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

function authRequest(path: string, body: unknown, cookie?: string) {
  return new Request(`${origin}/api/auth/${path}`, { method: 'POST', headers: { origin, 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
}
function authHandler(request: Request) {
  return handleAuth(request, { handler: authentication.handler, origin, production: false, ipHeader: 'x-real-ip' });
}
function cookies(response: Response) { return response.headers.getSetCookie().map(value => value.split(';')[0]).join('; '); }

describe('real authentication → API → PostgreSQL', () => {
  it('registers, persists a hashed password/session, creates projects, rejects outsiders, and revokes logout', async () => {
    const email = `owner-${randomUUID()}@example.test`;
    const password = 'a long unique test passphrase';
    const registration = await authHandler(authRequest('sign-up/email', { name: 'Test Homeowner', email, password }));
    expect(registration.status, await registration.clone().text()).toBe(200);
    const cookie = cookies(registration);
    expect(cookie).toContain('property.session_token=');
    expect(registration.headers.get('set-cookie')).toContain('HttpOnly');
    const user = await authentication.currentUser(new Headers({ cookie }));
    expect(user?.email).toBe(email);
    expect((await pool.query('SELECT password FROM account WHERE "userId"=$1', [user!.id])).rows[0].password).not.toBe(password);
    const api = createProjectApi(service, authentication.provider, origin);
    const request = (method: string, body?: unknown, requestCookie = cookie) => new Request(`${origin}/api/projects`, {
      method, headers: { cookie: requestCookie, origin, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const created = await api.collection(request('POST', { name: 'Authenticated house' }));
    expect(created.status).toBe(201);
    const project = await created.json();
    expect((await api.project(request('GET'), project.id)).status).toBe(200);
    expect((await api.project(request('GET', undefined, ''), project.id)).status).toBe(401);
    const otherRegistration = await authHandler(authRequest('sign-up/email', { name: 'Other owner', email: `other-${randomUUID()}@example.test`, password }));
    expect(otherRegistration.status).toBe(200);
    const outsiderCookie = cookies(otherRegistration);
    const protectedOperations = [
      (sessionCookie: string) => api.project(request('GET', undefined, sessionCookie), project.id),
      (sessionCookie: string) => api.project(request('PATCH', { name: 'Unauthorized edit', expectedRevision: 1, changeReason: 'Must not change another project' }, sessionCookie), project.id),
      (sessionCookie: string) => api.versions(request('GET', undefined, sessionCookie), project.id),
      (sessionCookie: string) => api.version(request('GET', undefined, sessionCookie), project.id, project.versionId),
      (sessionCookie: string) => api.members(request('GET', undefined, sessionCookie), project.id),
      (sessionCookie: string) => api.members(request('PUT', { userId: stranger.userId, role: 'PROFESSIONAL' }, sessionCookie), project.id),
      (sessionCookie: string) => api.member(request('DELETE', undefined, sessionCookie), project.id, user!.id),
    ];
    for (const operation of protectedOperations) {
      const anonymous = await operation('');
      expect(anonymous.status).toBe(401);
      const unauthorized = await operation(outsiderCookie);
      expect(unauthorized.status).toBe(404);
      expect(await unauthorized.text()).not.toContain(project.name);
    }
    const outsiderProjects = await api.collection(request('GET', undefined, outsiderCookie));
    expect(await outsiderProjects.json()).toEqual({ items: [], nextPage: null });
    expect((await api.collection(request('POST', { name: 'Anonymous project' }, ''))).status).toBe(401);
    expect((await service.get({ userId: user!.id }, project.id)).revision).toBe(1);
    expect(await service.members({ userId: user!.id }, project.id)).toHaveLength(1);
    expect((await pool.query('SELECT count(*)::int AS count FROM audit_events WHERE project_id=$1', [project.id])).rows[0].count).toBe(1);
    expect((await api.collection(request('POST', { name: 'Bad owner', ownerUserId: stranger.userId }))).status).toBe(422);
    expect((await api.project(request('PATCH', { name: 'Updated house', expectedRevision: 1, changeReason: 'New owner naming preference' }), project.id)).status).toBe(200);
    expect((await api.project(request('PATCH', { name: 'Stale name', expectedRevision: 1, changeReason: 'Stale state should conflict' }), project.id)).status).toBe(409);
    expect((await api.collection(new Request(`${origin}/api/projects`, { method: 'POST', headers: { cookie, origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' }))).status).toBe(403);
    const logout = await authHandler(authRequest('sign-out', {}, cookie));
    expect(logout.status).toBe(200);
    expect(await authentication.provider.authenticate(new Headers({ cookie }))).toBeNull();
    const login = await authHandler(authRequest('sign-in/email', { email, password }));
    expect(login.status, await login.clone().text()).toBe(200);
    expect((await api.project(request('GET', undefined, cookies(login)), project.id)).status).toBe(200);
    const wrong = await authHandler(authRequest('sign-in/email', { email, password: 'this is the wrong password' }));
    expect(wrong.status).toBe(401);
  });
  it('rejects expired sessions without cookie caching', async () => {
    const response = await authHandler(authRequest('sign-up/email', { name: 'Expiry test', email: `expiry-${randomUUID()}@example.test`, password: 'another long test passphrase' }));
    expect(response.status, await response.clone().text()).toBe(200);
    const headers = new Headers({ cookie: cookies(response) });
    const principal = await authentication.provider.authenticate(headers);
    expect(principal).not.toBeNull();
    await pool.query('UPDATE session SET "expiresAt"=now() - interval \'1 day\' WHERE "userId"=$1', [principal!.userId]);
    expect(await authentication.provider.authenticate(headers)).toBeNull();
  });
  it('denies unsupported provider endpoints and malformed authentication input', async () => {
    expect((await authHandler(authRequest('update-user', { name: 'changed' }))).status).toBe(404);
    expect((await authHandler(authRequest('sign-up/email', { name: 'Bad', email: 'not-email', password: 'short' }))).status).toBe(422);
    expect((await authHandler(new Request(`${origin}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }))).status).toBe(403);
  });
  it('requires the production proxy and issues secure cookies over HTTPS', async () => {
    const secureOrigin = 'https://property.example';
    const secureAuth = createAuthentication(pool, readConfig({ DATABASE_URL: connectionString, BETTER_AUTH_SECRET: 'production-test-only-secret-more-than-32-characters', APP_URL: secureOrigin, NODE_ENV: 'production' }));
    const input = { name: 'Secure account test', email: `secure-${randomUUID()}@example.test`, password: 'secure test long passphrase' };
    const transport = { handler: secureAuth.handler, origin: secureOrigin, production: true, ipHeader: 'x-real-ip' };
    const makeRequest = (ip: boolean) => new Request(`${secureOrigin}/api/auth/sign-up/email`, { method: 'POST', headers: { origin: secureOrigin, 'content-type': 'application/json', ...(ip ? { 'x-real-ip': '203.0.113.9' } : {}) }, body: JSON.stringify(input) });
    expect((await handleAuth(makeRequest(false), transport)).status).toBe(503);
    const response = await handleAuth(makeRequest(true), transport);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(response.headers.get('set-cookie')).toMatch(/; Secure/i);
    expect(response.headers.get('set-cookie')).toMatch(/; HttpOnly/i);
    expect(await secureAuth.provider.authenticate(new Headers({ cookie: cookies(response) }))).not.toBeNull();
  });
  it('persists authentication rate limits and blocks repeated login attempts', async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await authHandler(authRequest('sign-in/email', { email: 'missing@example.test', password: 'unknown long password' }))).status;
    expect(last).toBe(429);
    expect((await pool.query('SELECT count(*)::int AS count FROM "rateLimit"')).rows[0].count).toBeGreaterThan(0);
  });
});

// Phase 2 extends these same real transactions and authentication adapters.
describe('canonical land/site persistence', () => {
  it('loads V1 without site, upgrades on site save, and keeps old snapshots byte-for-byte', async () => {
    const project=await service.create(owner,{name:'Legacy land record'});
    const original=(await pool.query('SELECT snapshot::text FROM project_versions WHERE id=$1',[project.versionId])).rows[0].snapshot;
    expect((await service.site(owner,project.id)).site).toBeNull();
    const facts=rectangleFacts();facts.identity.plotNumber='Plot A/12';facts.location.address='Private test address';
    const saved=await service.saveSite(owner,project.id,{expectedRevision:1,changeReason:'Record site measurements',site:facts});
    expect(saved.revision).toBe(2);expect(saved.site.derived.calculatedArea?.value).toBe('200000000');
    expect((await service.version(owner,project.id,saved.versionId)).snapshot.schemaVersion).toBe(2);
    expect((await pool.query('SELECT snapshot::text FROM project_versions WHERE id=$1',[project.versionId])).rows[0].snapshot).toBe(original);
    expect((await service.version(owner,project.id,project.versionId)).snapshot.schemaVersion).toBe(1);
    const persisted=await new ProjectService(createProjectUnitOfWork(pool),randomUUID,()=>new Date()).site(owner,project.id);
    expect(persisted).toEqual(saved);
    const audit=(await pool.query('SELECT * FROM audit_events WHERE project_version_id=$1',[saved.versionId])).rows[0];
    expect(audit).toMatchObject({actor_id:owner.userId,action:'PROJECT_UPDATED',source:'HUMAN',before_data:{schemaVersion:1},after_data:{schemaVersion:2,site:saved.site}});
  });
  it('preserves stable geometry IDs and prior land versions through later metadata/site edits',async()=>{
    const project=await service.create(owner,{name:'Site revision home'}), facts=rectangleFacts();
    const first=await service.saveSite(owner,project.id,{expectedRevision:1,changeReason:'Initial dimensions',site:facts});
    if(facts.boundary?.kind!=='RECTANGLE') throw new Error('Fixture');
    facts.boundary.width.value='12';
    const second=await service.saveSite(owner,project.id,{expectedRevision:2,changeReason:'Correct measured width',site:facts});
    expect(second.site.derived.boundary?.edges.map(e=>e.id)).toEqual(first.site.derived.boundary?.edges.map(e=>e.id));
    expect((await service.version(owner,project.id,first.versionId)).snapshot.site).toEqual(first.site);
    await service.update(owner,project.id,{expectedRevision:3,name:'Renamed site home',changeReason:'Rename only, keep site'});
    expect((await service.site(owner,project.id)).site).toEqual(second.site);
    const noop=await service.saveSite(owner,project.id,{expectedRevision:4,changeReason:'No factual changes',site:facts});
    expect(noop.revision).toBe(4);
  });
  it('rejects unauthorized site reads/saves and redacts all new private data from professional history',async()=>{
    const project=await service.create(owner,{name:'Scoped site'}),facts=rectangleFacts();facts.location.address='PRIVATE SITE ADDRESS';facts.identity.notes='PRIVATE TITLE NOTE';
    const saved=await service.saveSite(owner,project.id,{expectedRevision:1,changeReason:'PRIVATE CHANGE NOTE',site:facts});
    await service.assignMember(owner,project.id,{userId:professional.userId,role:'PROFESSIONAL'});
    await service.assignMember(owner,project.id,{userId:contributor.userId,role:'CONTRACTOR_CONTRIBUTOR'});
    for(const [actor,code] of [[stranger,'NOT_FOUND'],[professional,'FORBIDDEN'],[contributor,'FORBIDDEN']] as const) {
      await expect(service.site(actor,project.id)).rejects.toMatchObject({code});
      await expect(service.saveSite(actor,project.id,{expectedRevision:2,changeReason:'Unauthorized mutation',site:facts})).rejects.toMatchObject({code});
    }
    const history=await service.versions(professional,project.id), version=await service.version(professional,project.id,saved.versionId);
    for(const value of [history,version,await service.list(owner),await service.get(owner,project.id),await service.list(professional)]) {
      expect(JSON.stringify(value)).not.toContain('PRIVATE');expect(JSON.stringify(value)).not.toContain('latitude');
    }
    expect(version.snapshot).not.toHaveProperty('site');expect(version.redactedFields).toEqual(['site','changeReason']);
    await service.removeMember(owner,project.id,professional.userId);
    await expect(service.versions(professional,project.id)).rejects.toMatchObject({code:'NOT_FOUND'});
  });
  it('serializes concurrent metadata/site writes and rejects stale land edits',async()=>{
    const project=await service.create(owner,{name:'Concurrent site'});
    const results=await Promise.allSettled([
      service.saveSite(owner,project.id,{expectedRevision:1,changeReason:'Add land record',site:rectangleFacts()}),
      service.update(owner,project.id,{expectedRevision:1,name:'Concurrent rename',changeReason:'Rename this project'}),
    ]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{code:'CONFLICT'}});
    await expect(service.saveSite(owner,project.id,{expectedRevision:1,changeReason:'Stale land submission',site:rectangleFacts()})).rejects.toMatchObject({code:'CONFLICT'});
    expect((await service.versions(owner,project.id)).items).toHaveLength(2);
  });
  it('rolls back a site revision and pointer when audit persistence fails',async()=>{
    const project=await service.create(owner,{name:'Atomic site'});
    const broken: ProjectUnitOfWork={read:uow.read,transaction:work=>uow.transaction(repo=>work(new Proxy(repo,{
      get(target,key){if(key==='audit')return async()=>{throw new Error('Audit failure');};const item=Reflect.get(target,key);return typeof item==='function'?item.bind(target):item;},
    })))};
    await expect(new ProjectService(broken,randomUUID,()=>new Date()).saveSite(owner,project.id,{expectedRevision:1,changeReason:'Must roll back',site:rectangleFacts()})).rejects.toThrow('Audit failure');
    expect((await service.get(owner,project.id)).revision).toBe(1);
    expect((await service.site(owner,project.id)).site).toBeNull();
    expect((await service.versions(owner,project.id)).items).toHaveLength(1);
  });
  it('validates the HTTP boundary with real cookies, private responses and malformed/forged input',async()=>{
    const registration=await authHandler(authRequest('sign-up/email',{name:'Site API test',email:`site-${randomUUID()}@example.test`,password:'site-api-only-long-passphrase'}));
    expect(registration.status).toBe(200);
    const cookie=cookies(registration), actor=(await authentication.provider.authenticate(new Headers({cookie})))!;
    const project=await service.create(actor,{name:'Authenticated site'}),api=createProjectApi(service,authentication.provider,origin);
    const request=(method:string,body?:unknown,session=cookie)=>new Request(`${origin}/api/projects/${project.id}/site`,{method,headers:{origin,cookie:session,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    for(const method of ['GET','PUT']) expect((await api.site(request(method,method==='PUT'?{}:undefined,''),project.id)).status).toBe(401);
    expect((await api.site(request('GET'),randomUUID())).status).toBe(404);
    const invalid=rectangleFacts();if(invalid.boundary?.kind==='RECTANGLE')invalid.boundary.width.value='-1';
    expect((await api.site(request('PUT',{expectedRevision:1,changeReason:'Invalid width',site:invalid}),project.id)).status).toBe(422);
    expect((await api.site(request('PUT',{expectedRevision:1,changeReason:'Forged derived state',site:buildSite(rectangleFacts())}),project.id)).status).toBe(422);
    const saved=await api.site(request('PUT',{expectedRevision:1,changeReason:'Save from authenticated API',site:rectangleFacts()}),project.id);
    expect(saved.status).toBe(200);expect(saved.headers.get('cache-control')).toBe('no-store');
    expect((await saved.json()).revision).toBe(2);
    expect((await api.site(request('PUT',{expectedRevision:1,changeReason:'Reject stale API write',site:rectangleFacts()}),project.id)).status).toBe(409);
    const crossSite=new Request(`${origin}/api/projects/${project.id}/site`,{method:'PUT',headers:{cookie,origin:'https://unrelated.example','content-type':'application/json'},body:'{}'});
    expect((await api.site(crossSite,project.id)).status).toBe(403);
  });
  it('enforces SQL schema, canonical coordinate, edge, area and road invariants',async()=>{
    const project=await service.create(owner,{name:'SQL site constraints'});
    const v1=(await service.version(owner,project.id,project.versionId)).snapshot;
    const site=buildSite(rectangleFacts());
    async function insert(snapshot:unknown,version=2) {
      return pool.query(`INSERT INTO project_versions(id,project_id,revision,schema_version,snapshot,created_by,source,change_reason) VALUES($1,$2,2,$3,$4,$5,'HUMAN','SQL invariant validation')`,[randomUUID(),project.id,version,JSON.stringify(snapshot),owner.userId]);
    }
    await expect(insert({...v1,site:null},1)).rejects.toThrow('site_presence');
    await expect(insert({...v1,schemaVersion:2})).rejects.toThrow('site_presence');
    await expect(insert({...v1,schemaVersion:3,site:null},3)).rejects.toMatchObject({code:'23514'});
    for(const mutate of [
      (value:typeof site)=>{value.derived.boundary!.unit='ft' as 'mm';},
      (value:typeof site)=>{value.derived.boundary!.vertices[0]!.x=0.1;},
      (value:typeof site)=>{value.derived.boundary!.edges[0]!.toVertexId=randomUUID();},
      (value:typeof site)=>{value.derived.calculatedArea!.value='1';},
      (value:typeof site)=>{value.facts.roads=[{id:randomUUID(),edgeId:randomUUID(),width:null,primaryAccess:true}];},
      (value:typeof site)=>{value.facts.location.latitude=100;},
    ]) {const changed=structuredClone(site);mutate(changed);await expect(insert({...v1,schemaVersion:2,site:changed})).rejects.toThrow('valid_site');}
    const saved=await service.saveSite(owner,project.id,{expectedRevision:1,changeReason:'Valid canonical geometry',site:site.facts});
    await expect(pool.query('UPDATE project_versions SET snapshot=$1 WHERE id=$2',[JSON.stringify({...v1,schemaVersion:2,site}),saved.versionId])).rejects.toThrow('append-only');
  });
});
