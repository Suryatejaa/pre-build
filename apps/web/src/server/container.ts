import 'server-only';
import { randomUUID } from 'node:crypto';
import { createPool, createProjectUnitOfWork } from '@property/database';
import { ProjectService } from '@property/services';
import { createAuthentication } from '@property/infrastructure/auth';
import { readConfig } from '@property/infrastructure/config';
import { LocalObjectStorage } from '@property/infrastructure/storage';

function createContainer() {
  const config = readConfig();
  const pool = createPool(config.DATABASE_URL);
  return { config, pool, auth: createAuthentication(pool, config),
    projects: new ProjectService(createProjectUnitOfWork(pool), randomUUID, () => new Date()),
    storage: new LocalObjectStorage(config.STORAGE_LOCAL_ROOT) };
}
const globalContainer = globalThis as typeof globalThis & { propertyContainer?: ReturnType<typeof createContainer> };
/** Lazy initialization permits a build without credentials and reuses the pool during development refreshes. */
export function getContainer() { return globalContainer.propertyContainer ??= createContainer(); }
