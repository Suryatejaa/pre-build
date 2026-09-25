import 'server-only';
import { randomUUID } from 'node:crypto';
import { createPool, createProjectUnitOfWork, createRequirementsUnitOfWork } from '@property/database';
import { ProjectService, RequirementsInterviewService } from '@property/services';
import { createAuthentication } from '@property/infrastructure/auth';
import { readConfig } from '@property/infrastructure/config';
import { LocalObjectStorage } from '@property/infrastructure/storage';
import { configuredRequirementsAiProvider } from '@property/infrastructure/requirements-ai';

function createSharedResources() {
  const config = readConfig();
  const pool = createPool(config.DATABASE_URL);
  return { config, pool, auth: createAuthentication(pool, config),
    storage: new LocalObjectStorage(config.STORAGE_LOCAL_ROOT), requirementsAi: configuredRequirementsAiProvider() };
}
const globalContainer = globalThis as typeof globalThis & { propertyContainer?: ReturnType<typeof createSharedResources> };
let moduleProjects: ProjectService | undefined;
let moduleRequirements: RequirementsInterviewService | undefined;
/** Share external resources globally and keep service instances within the current module graph.
 * Domain errors carry a global brand so separate bundle copies can still recognize one another. */
export function getContainer() {
  const shared = globalContainer.propertyContainer ??= createSharedResources();
  return { ...shared,
    projects: moduleProjects ??= new ProjectService(createProjectUnitOfWork(shared.pool), randomUUID, () => new Date()),
    requirements: moduleRequirements ??= new RequirementsInterviewService(createRequirementsUnitOfWork(shared.pool), shared.requirementsAi, randomUUID, () => new Date()),
  };
}
