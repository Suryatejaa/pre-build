import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  { settings: { next: { rootDir: 'apps/web' } } },
  { files: ['packages/domain/**/*.ts'], rules: {
    'no-restricted-imports': ['error', { patterns: ['@property/database*', '@property/infrastructure*', '@property/services*', 'react*', 'next*', 'pg', 'better-auth*'] }]
  } },
  { files: ['packages/services/**/*.ts'], rules: {
    'no-restricted-imports': ['error', { patterns: ['@property/database*', '@property/infrastructure*', 'react*', 'next*', 'pg', 'better-auth*'] }]
  } },
  { files: ['apps/web/src/components/**/*.tsx'], rules: {
    'no-restricted-imports': ['error', { patterns: ['@property/database*', '@property/infrastructure*', '@property/services*'] }]
  } },
  globalIgnores(['**/.next/**', '**/next-env.d.ts', '**/node_modules/**', '**/coverage/**'])
]);
