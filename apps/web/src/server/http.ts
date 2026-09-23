import { randomUUID } from 'node:crypto';
import { DomainError, type AuthenticationProvider, type Principal } from '@property/domain';
import { ZodError } from 'zod';

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}
export function enforceOrigin(request: Request, origin: string) {
  if (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new DomainError('FORBIDDEN', 'This request must come from this application.');
  }
}
/** Stream-capped before JSON parsing, including requests without Content-Length. */
export async function readJson(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') {
    throw new DomainError('INVALID_INPUT', 'Send application/json.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError('INVALID_INPUT', 'A request body is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > 16384) { await reader.cancel(); throw new DomainError('PAYLOAD_TOO_LARGE', 'This request is too large.'); }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new DomainError('INVALID_INPUT', 'Invalid JSON.'); }
}
export async function withErrors(work: () => Promise<Response>) {
  const requestId = randomUUID();
  try {
    const response = await work();
    response.headers.set('X-Request-Id', requestId);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Something went wrong. Please try again.';
    let issues: { path: string; message: string }[] | undefined;
    if (error instanceof DomainError) {
      status = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, INVALID_INPUT: 422, PAYLOAD_TOO_LARGE: 413 }[error.code];
      code = error.code; message = error.message;
    } else if (error instanceof ZodError) {
      status = 422; code = 'INVALID_INPUT'; message = 'Please check the supplied information.';
      issues = error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message }));
    } else {
      // No bodies, cookies, emails, SQL, connection strings, or error messages in logs.
      console.error('Request failed', { requestId, errorType: error instanceof Error ? error.name : 'Unknown' });
    }
    const response = json({ error: { code, message, issues, requestId } }, status);
    response.headers.set('X-Request-Id', requestId);
    return response;
  }
}
export async function authenticated(
  request: Request, auth: AuthenticationProvider, origin: string,
  work: (actor: Principal) => Promise<Response>,
) {
  return withErrors(async () => {
    if (!['GET', 'HEAD'].includes(request.method)) enforceOrigin(request, origin);
    const actor = await auth.authenticate(request.headers);
    if (!actor) throw new DomainError('UNAUTHENTICATED', 'Please sign in to continue.');
    return work(actor);
  });
}
