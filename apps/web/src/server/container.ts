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
    storage: new LocalObjectStorage(config.STORAGE_LOCAL_ROOT) };
}
const globalContainer = globalThis as typeof globalThis & { propertyContainer?: ReturnType<typeof createSharedResources> };
let moduleProjects: ProjectService | undefined;
let moduleRequirements: RequirementsInterviewService | undefined;
/** Share external resources globally and keep services and their AI router within the current module graph.
 * Keeping router errors in that graph preserves typed failure diagnostics across Next.js reloads/bundles.
 * Domain errors carry a global brand so separate bundle copies can still recognize one another. */
export function getContainer() {
  const shared = globalContainer.propertyContainer ??= createSharedResources();
  return { ...shared,
    projects: moduleProjects ??= new ProjectService(createProjectUnitOfWork(shared.pool), randomUUID, () => new Date()),
    requirements: moduleRequirements ??= new RequirementsInterviewService(createRequirementsUnitOfWork(shared.pool), configuredRequirementsAiProvider(), randomUUID, () => new Date(), diagnostic => console.error('Requirements interview pipeline failed', diagnostic)),
  };
}
