import { defineConfig } from '@playwright/test';

const dataRoot = '/tmp/arcane-codex-browser-tests';

export default defineConfig({
  testDir: './tests',
  testMatch: 'browser-flows.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4321',
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `rm -rf ${dataRoot} && npm run start`,
    url: 'http://127.0.0.1:4321/api/health',
    timeout: 30_000,
    reuseExistingServer: false,
    env: {
      ARCANE_DATA_DIR: dataRoot,
      PORT: '4321',
    },
  },
});
