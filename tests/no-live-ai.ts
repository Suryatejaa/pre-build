import { beforeEach, vi } from 'vitest';

// Node-only tests use injected adapters. No test may accidentally spend real AI credits.
vi.mock('server-only', () => ({}));
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Live external fetch is forbidden in tests; inject a deterministic fetcher.'); }));
});
