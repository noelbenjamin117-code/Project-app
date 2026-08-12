import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '~/gym.config': fileURLToPath(new URL('./gym.config.ts', import.meta.url)),
      // Services carry the `server-only` guard so they can never be pulled
      // into a client bundle; under test it is a no-op.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Integration tests share one Postgres database, so they run serially
    // rather than fighting each other over the same rows.
    fileParallelism: false,
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgresql://postgres@localhost:5433/gym_test?schema=public',
      SESSION_SECRET: 'test-secret-value-that-is-definitely-long-enough-000',
    },
    testTimeout: 20_000,
  },
});
