import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { DomainError } from '@property/domain';
import type { ProjectService, RequirementsInterviewService } from '@property/services';
import { createProjectApi } from '../apps/web/src/server/project-api';

const origin = 'http://localhost:3000';
const actor = { userId: randomUUID() };
const request = (path: string, method: string, body?: unknown) => new Request(`${origin}${path}`, {
  method, headers: { origin, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
});

it('returns owner interview provider failures as safe recoverable HTTP errors', async () => {
  const service = { get: async () => { throw new DomainError('AI_UNAVAILABLE', 'AI is not configured. Your saved message is safe.'); } } as unknown as RequirementsInterviewService;
  const api = createProjectApi({} as ProjectService, { authenticate: async () => actor }, origin, service);
  const response = await api.requirements(request('/api/projects/00000000-0000-4000-8000-000000000001/requirements', 'GET'), '00000000-0000-4000-8000-000000000001');
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: { code: 'AI_UNAVAILABLE', message: 'AI is not configured. Your saved message is safe.' } });
});

it('rejects unsupported interview actions through the standard validation envelope', async () => {
  const service = {} as RequirementsInterviewService;
  const api = createProjectApi({} as ProjectService, { authenticate: async () => actor }, origin, service);
  const response = await api.requirementsInterview(request('/api/projects/p/requirements/interview', 'POST', { action: 'delete', expectedRevision: 1 }), '00000000-0000-4000-8000-000000000001');
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ error: { code: 'INVALID_INPUT' } });
});

it('requires a session before owner-only requirements operations', async () => {
  const service = {} as RequirementsInterviewService;
  const api = createProjectApi({} as ProjectService, { authenticate: async () => null }, origin, service);
  const response = await api.requirements(request('/api/projects/p/requirements', 'GET'), '00000000-0000-4000-8000-000000000001');
  expect(response.status).toBe(401);
});
