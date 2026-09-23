import { projectApi } from '@/server/api';
export async function DELETE(request: Request, context: { params: Promise<{ projectId: string; userId: string }> }) {
  const { projectId, userId } = await context.params;
  return projectApi().member(request, projectId, userId);
}
