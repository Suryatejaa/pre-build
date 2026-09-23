import { projectApi } from '@/server/api';
export async function GET(request: Request, context: { params: Promise<{ projectId: string; versionId: string }> }) {
  const { projectId, versionId } = await context.params;
  return projectApi().version(request, projectId, versionId);
}
