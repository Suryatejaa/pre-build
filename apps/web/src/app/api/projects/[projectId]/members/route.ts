import { projectApi } from '@/server/api';
type Context = { params: Promise<{ projectId: string }> };
export async function GET(request: Request, context: Context) { return projectApi().members(request, (await context.params).projectId); }
export async function PUT(request: Request, context: Context) { return projectApi().members(request, (await context.params).projectId); }
