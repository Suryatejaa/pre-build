import 'server-only';
import { notFound } from 'next/navigation';
import { idSchema, isDomainError } from '@property/domain';
import { requireUser } from './session';
import { getContainer } from './container';
export async function loadProject(projectId: string) {
  if (!idSchema.safeParse(projectId).success) notFound();
  const user = await requireUser();
  try { return await getContainer().projects.get({ userId: user.id }, projectId); }
  catch (error) { if (isDomainError(error) && ['NOT_FOUND', 'FORBIDDEN'].includes(error.code)) notFound(); throw error; }
}
