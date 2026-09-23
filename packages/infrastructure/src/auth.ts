import { betterAuth } from 'better-auth';
import type { Pool } from 'pg';
import type { AuthenticationProvider } from '@property/domain';
import type { AppConfig } from './config';

export function createAuthentication(pool: Pool, config: AppConfig) {
  const auth = betterAuth({
    appName: 'Property Record',
    database: pool,
    baseURL: config.APP_URL,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.APP_URL],
    emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128, autoSignIn: true },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    account: { accountLinking: { enabled: false } },
    user: { deleteUser: { enabled: false }, changeEmail: { enabled: false } },
    advanced: {
      database: { generateId: 'uuid' },
      useSecureCookies: config.NODE_ENV === 'production',
      cookiePrefix: 'property',
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
      ipAddress: { ipAddressHeaders: [config.AUTH_IP_HEADER] },
    },
    rateLimit: {
      enabled: true, storage: 'database', window: 60, max: 100,
      customRules: { '/sign-in/email': { window: 60, max: 10 }, '/sign-up/email': { window: 60, max: 5 } },
    },
  });
  const provider: AuthenticationProvider = {
    async authenticate(headers) {
      const session = await auth.api.getSession({ headers });
      return session ? { userId: session.user.id } : null;
    },
  };
  return {
    provider,
    handler: auth.handler,
    async currentUser(headers: Headers) {
      const session = await auth.api.getSession({ headers });
      if (!session) return null;
      return { id: session.user.id, name: session.user.name, email: session.user.email, emailVerified: session.user.emailVerified };
    },
  };
}
