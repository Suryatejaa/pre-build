import { projectApi } from '@/server/api';
type Context = { params: Promise<{ projectId: string }> };
export async function POST(request: Request, context: Context) { return projectApi().requirementSiteDiscrepancy(request, (await context.params).projectId); }
