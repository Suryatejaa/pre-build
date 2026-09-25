import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';

const { pool } = vi.hoisted(() => ({ pool: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock('server-only', () => ({}));
vi.mock('@property/database', async importOriginal => ({
  ...await importOriginal<typeof import('@property/database')>(),
  createPool: () => pool,
}));
vi.mock('@property/infrastructure/auth', () => ({ createAuthentication: () => ({}) }));

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

it('maps stale project and Site writes from an earlier module copy to HTTP 409', async () => {
  vi.stubEnv('DATABASE_URL', 'postgresql://localhost/property_test');
  vi.stubEnv('BETTER_AUTH_SECRET', 'container-test-only-secret-with-more-than-32-characters');
  vi.stubEnv('APP_URL', 'http://localhost:3000');
  vi.stubGlobal('propertyContainer', undefined);

  const { emptySiteFacts } = await import('@property/domain');
  const { ProjectService: CachedProjectService } = await import('@property/services');
  const first = (await import('../apps/web/src/server/container')).getContainer();

  // Simulate a service retained by an older Next.js module bundle.
  vi.resetModules();
  const currentModule = await import('../apps/web/src/server/container');
  const current = currentModule.getContainer();
  const currentAgain = currentModule.getContainer();
  const { createProjectApi } = await import('../apps/web/src/server/project-api');
  const actor = { userId: randomUUID() };
  const projectId = randomUUID();
  const repository = {
    find: async () => ({
      role: 'OWNER' as const,
      project: {
        id: projectId,
        ownerUserId: actor.userId,
        currentRevision: 2,
        currentVersion: { snapshot: { schemaVersion: 1, projectId, name: 'Home', propertyType: 'RESIDENTIAL_HOUSE', status: 'ACTIVE' } },
      },
    }),
  };
  const oldService = new CachedProjectService({
    read: repository,
    transaction: async (work: (repo: typeof repository) => Promise<unknown>) => work(repository),
  } as never, randomUUID, () => new Date());
  const api = createProjectApi(oldService as never, { authenticate: async () => actor }, 'http://localhost:3000');
  const request = (method: string, body: unknown) => new Request(`http://localhost:3000/api/projects/${projectId}`, {
    method,
    headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const projectResponse = await api.project(request('PATCH', {
    expectedRevision: 1, name: 'Stale edit', changeReason: 'Request from old project page',
  }), projectId);
  const siteResponse = await api.site(request('PUT', {
    expectedRevision: 1, changeReason: 'Request from old Site page', site: emptySiteFacts(),
  }), projectId);

  expect(current.pool).toBe(first.pool);
  expect(current.projects).not.toBe(first.projects);
  expect(currentAgain.projects).toBe(current.projects);
  expect(projectResponse.status).toBe(409);
  expect(await projectResponse.json()).toMatchObject({ error: { code: 'CONFLICT' } });
  expect(siteResponse.status).toBe(409);
  expect(await siteResponse.json()).toMatchObject({ error: { code: 'CONFLICT' } });

  const { withErrors } = await import('../apps/web/src/server/http');
  const unbranded = await withErrors(async () => {
    throw Object.assign(new Error('untrusted error'), { code: 'CONFLICT' });
  });
  expect(unbranded.status).toBe(500);
});
