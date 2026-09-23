import { describe, expect, it } from 'vitest';
import { authenticated, enforceOrigin, readJson, withErrors } from '../apps/web/src/server/http';
import { readConfig } from '@property/infrastructure/config';

describe('HTTP boundary', () => {
  it('rejects missing and foreign origins', () => {
    for (const origin of [undefined, 'https://hostile.example']) {
      expect(() => enforceOrigin(new Request('https://property.example/api/projects', { method: 'POST', headers: origin ? { origin } : {} }), 'https://property.example')).toThrow();
    }
  });
  it('caps bodies even without a content-length header and rejects malformed JSON', async () => {
    const request = (body: string) => new Request('https://property.example', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    await expect(readJson(request('x'.repeat(16385)))).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    await expect(readJson(request('{ broken'))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(readJson(request('{"name":"Home"}'))).resolves.toEqual({ name: 'Home' });
  });
  it('requires an authenticated principal independently of the UI', async () => {
    const response = await authenticated(new Request('https://property.example'), { authenticate: async () => null }, 'https://property.example', async () => Response.json({ secret: true }));
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toBeTruthy();
  });
  it('does not expose exception details', async () => {
    const response = await withErrors(async () => { throw new Error('database password: secret'); });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('secret');
  });
});
describe('configuration', () => {
  const environment = { DATABASE_URL: 'postgresql://local/database', BETTER_AUTH_SECRET: 'a'.repeat(48), APP_URL: 'http://localhost:3000' };
  it('fails closed for missing secrets and insecure production origins', () => {
    expect(() => readConfig({ ...environment, BETTER_AUTH_SECRET: 'short' })).toThrow('configuration');
    expect(() => readConfig({ ...environment, BETTER_AUTH_SECRET: 'replace-with-at-least-32-random-characters' })).toThrow('configuration');
    expect(() => readConfig({ ...environment, NODE_ENV: 'production' })).toThrow('HTTPS');
    expect(readConfig({ ...environment, NODE_ENV: 'production', APP_URL: 'https://property.example' }).APP_URL).toBe('https://property.example');
  });
});
