import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.integration.test.ts'], setupFiles: ['tests/no-live-ai.ts'], fileParallelism: false, testTimeout: 30000, hookTimeout: 30000 } });
