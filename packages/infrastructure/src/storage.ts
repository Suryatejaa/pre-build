import { constants } from 'node:fs';
import { mkdir, open, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { idSchema, type ObjectStorage, type StoredObject } from '@property/domain';

/** Private local development adapter. Files are outside public/, with opaque immutable keys. */
export class LocalObjectStorage implements ObjectStorage {
  private readonly root: string;
  constructor(root: string, private readonly maxBytes = 20 * 1024 * 1024) { this.root = resolve(root); }
  private file(key: string) { return join(this.root, idSchema.parse(key)); }
  async put(bytes: Uint8Array): Promise<StoredObject> {
    if (bytes.byteLength > this.maxBytes) throw new Error(`Object exceeds the ${this.maxBytes} byte limit.`);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const key = randomUUID();
    const file = await open(this.file(key), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(bytes); await file.sync(); }
    catch (error) { await unlink(this.file(key)).catch(() => undefined); throw error; }
    finally { await file.close(); }
    return { key, size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  async get(key: string): Promise<Uint8Array | null> {
    try {
      const file = await open(this.file(key), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > this.maxBytes) throw new Error('Invalid stored object.');
        return await file.readFile();
      } finally { await file.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async delete(key: string) {
    try { await unlink(this.file(key)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
