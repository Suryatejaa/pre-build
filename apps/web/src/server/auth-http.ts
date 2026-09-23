import { z } from 'zod';
import { enforceOrigin, json, readJson, withErrors } from './http';

const credentials = z.strictObject({ email: z.email().max(254).transform(value => value.toLowerCase()), password: z.string().min(1).max(128) });
const registration = credentials.extend({ name: z.string().trim().min(1).max(120), password: z.string().min(12).max(128) });
interface AuthTransport {
  handler: (request: Request) => Promise<Response>;
  origin: string;
  production: boolean;
  ipHeader: string;
}
/** Deliberately expose only supported account workflows; provider APIs are not automatically public. */
export function handleAuth(request: Request, options: AuthTransport) {
  return withErrors(async () => {
    const path = new URL(request.url).pathname.replace('/api/auth/', '');
    const allowed = request.method === 'GET' ? ['get-session'] : request.method === 'POST' ? ['sign-up/email', 'sign-in/email', 'sign-out'] : [];
    if (!allowed.includes(path)) return json({ error: { message: 'Not found.' } }, 404);
    const headers = new Headers(request.headers);
    if (!options.production) headers.set(options.ipHeader, '127.0.0.1');
    if (options.production && !headers.get(options.ipHeader)) return json({ error: { message: 'Authentication proxy is not configured.' } }, 503);
    if (request.method === 'POST') {
      enforceOrigin(request, options.origin);
      const input = await readJson(request);
      const data = path === 'sign-up/email' ? registration.parse(input) : path === 'sign-in/email' ? credentials.parse(input) : z.strictObject({}).parse(input);
      headers.delete('content-length');
      return options.handler(new Request(request.url, { method: 'POST', headers, body: JSON.stringify(data) }));
    }
    return options.handler(new Request(request.url, { method: 'GET', headers }));
  });
}
