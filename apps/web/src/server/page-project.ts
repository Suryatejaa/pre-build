import 'server-only';
import { notFound } from 'next/navigation';
import { DomainError, idSchema } from '@property/domain';
import { requireUser } from './session';
import { getContainer } from './container';
export async function loadProject(projectId: string) {
  if (!idSchema.safeParse(projectId).success) notFound();
  const user = await requireUser();
  try { return await getContainer().projects.get({ userId: user.id }, projectId); }
  catch (error) { if (error instanceof DomainError && ['NOT_FOUND', 'FORBIDDEN'].includes(error.code)) notFound(); throw error; }
}
