import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LocalObjectStorage } from '@property/infrastructure/storage';

const roots: string[] = [];
async function setup(max?: number) {
  const root = await mkdtemp(join(tmpdir(), 'property-storage-'));
  roots.push(root);
  return { root, store: new LocalObjectStorage(root, max) };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
describe('private object storage contract', () => {
  it('persists bytes across adapter instances with immutable opaque keys and checksums', async () => {
    const { root, store } = await setup();
    const bytes = new TextEncoder().encode('original document');
    const first = await store.put(bytes);
    const second = await store.put(bytes);
    expect(first.key).not.toBe(second.key);
    expect(first.sha256).toBe(second.sha256);
    expect(first.size).toBe(bytes.length);
    expect(Buffer.from((await new LocalObjectStorage(root).get(first.key))!).toString()).toBe('original document');
    expect((await stat(join(root, first.key))).mode & 0o777).toBe(0o600);
    await store.delete(first.key);
    await store.delete(first.key);
    expect(await store.get(first.key)).toBeNull();
    expect(await store.get(second.key)).not.toBeNull();
  });
  it('rejects traversal, absolute paths, invalid keys, oversized content and symlinks', async () => {
    const { root, store } = await setup(4);
    for (const key of ['../secret', '/etc/passwd', 'user/document', '%2e%2e']) {
      await expect(store.get(key)).rejects.toThrow();
      await expect(store.delete(key)).rejects.toThrow();
    }
    await expect(store.put(new Uint8Array(5))).rejects.toThrow('limit');
    const key = randomUUID();
    await symlink('/etc/hosts', join(root, key));
    await expect(store.get(key)).rejects.toThrow();
    expect(await store.get(randomUUID())).toBeNull();
  });
});
