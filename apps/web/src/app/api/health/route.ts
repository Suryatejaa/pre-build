import { getContainer } from '@/server/container';
import { isDatabaseReady } from '@property/database';
import { json } from '@/server/http';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    if (!await isDatabaseReady(getContainer().pool)) return json({ status: 'unavailable' }, 503);
    return json({ status: 'ok' });
  } catch { return json({ status: 'unavailable' }, 503); }
}
