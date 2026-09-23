import { resolve } from 'node:path';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.url().refine(value => /^postgres(ql)?:/.test(value), 'Use a PostgreSQL URL.'),
  BETTER_AUTH_SECRET: z.string().min(32).refine(value => !value.startsWith('replace-'), 'Generate a random authentication secret.'),
  APP_URL: z.url().transform(value => new URL(value).origin),
  STORAGE_LOCAL_ROOT: z.string().min(1).default('.data/objects'),
  AUTH_IP_HEADER: z.string().regex(/^[a-z-]+$/).default('x-real-ip'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});
export function readConfig(environment: NodeJS.ProcessEnv = process.env) {
  const result = schema.safeParse(environment);
  if (!result.success) throw new Error(`Invalid server configuration: ${result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  const value = result.data;
  if (value.NODE_ENV === 'production' && !value.APP_URL.startsWith('https://')) {
    throw new Error('APP_URL must use HTTPS in production.');
  }
  return { ...value, STORAGE_LOCAL_ROOT: resolve(value.STORAGE_LOCAL_ROOT) };
}
export type AppConfig = ReturnType<typeof readConfig>;
