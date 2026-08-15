import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'auth-6.integration.spec.js',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:5173',
    ...devices['Desktop Chrome'],
    channel: 'chrome',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
})
