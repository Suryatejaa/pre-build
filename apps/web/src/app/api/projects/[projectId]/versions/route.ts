import { projectApi } from '@/server/api';
export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) { return projectApi().versions(request, (await context.params).projectId); }
