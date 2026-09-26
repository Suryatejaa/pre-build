import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], setupFiles: ['tests/no-live-ai.ts'], testTimeout: 15000 } });
