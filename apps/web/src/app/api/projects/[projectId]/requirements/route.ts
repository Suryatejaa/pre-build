import { projectApi } from '@/server/api';
type Context = { params: Promise<{ projectId: string }> };
export async function GET(request: Request, context: Context) { return projectApi().requirements(request, (await context.params).projectId); }
export async function PATCH(request: Request, context: Context) { return projectApi().requirements(request, (await context.params).projectId); }
