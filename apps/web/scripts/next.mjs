import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const environmentFile = resolve(root, '.env');
if (existsSync(environmentFile)) loadEnvFile(environmentFile);
if (process.env.STORAGE_LOCAL_ROOT) process.env.STORAGE_LOCAL_ROOT = resolve(root, process.env.STORAGE_LOCAL_ROOT);
// Load env in-process: Next forwards execArgv to workers, where --env-file is disallowed.
await import('next/dist/bin/next');
