import { getContainer } from '@/server/container';
import { json, withErrors } from '@/server/http';
export async function GET(request: Request) {
  return withErrors(async () => {
    const user = await getContainer().auth.currentUser(request.headers);
    return user ? json(user) : json({ error: { code: 'UNAUTHENTICATED', message: 'Please sign in.' } }, 401);
  });
}
