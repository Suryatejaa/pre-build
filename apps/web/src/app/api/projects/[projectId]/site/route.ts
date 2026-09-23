import { projectApi } from '@/server/api';
export const runtime = 'nodejs';
type Context = { params: Promise<{ projectId: string }> };
export async function GET(request: Request, context: Context) { return projectApi().site(request, (await context.params).projectId); }
export async function PUT(request: Request, context: Context) { return projectApi().site(request, (await context.params).projectId); }
