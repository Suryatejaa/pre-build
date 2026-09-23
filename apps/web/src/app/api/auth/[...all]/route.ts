import { getContainer } from '@/server/container';
import { handleAuth } from '@/server/auth-http';
export const runtime = 'nodejs';
function handler(request: Request) {
  const { auth, config } = getContainer();
  return handleAuth(request, { handler: auth.handler, origin: config.APP_URL, production: config.NODE_ENV === 'production', ipHeader: config.AUTH_IP_HEADER });
}
export { handler as GET, handler as POST };
