import { defineConfig, devices } from '@playwright/test'

const e2ePort = Number(process.env.E2E_PORT ?? 3100)
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // E2E fixtures append immutable ledger rows to one isolated database branch.
  // Keep files serial so independent scenarios cannot contend for its connection.
  workers: 1,
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: e2eBaseUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'mobile-chromium', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: `node_modules\\.bin\\next.cmd dev --port ${e2ePort}`,
    url: e2eBaseUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
