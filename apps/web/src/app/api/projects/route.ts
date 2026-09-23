import { projectApi } from '@/server/api';
export const runtime = 'nodejs';
export function GET(request: Request) { return projectApi().collection(request); }
export function POST(request: Request) { return projectApi().collection(request); }
