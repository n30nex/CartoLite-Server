import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  retries: process.env.CI ? 1 : 0,
  // Renderer timing is meaningful only when one Chromium instance owns the
  // shared Actions CPU; concurrent software-rendered maps distort the gate.
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.CARTOLITE_BASE_URL ?? 'http://127.0.0.1:39476',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { args: ['--enable-unsafe-swiftshader'] }
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: /tablet-portrait\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }
    },
    { name: 'mobile', testIgnore: /tablet-portrait\.spec\.ts/, use: { ...devices['Pixel 7'] } },
    {
      name: 'mobile-tablet-portrait',
      testMatch: /tablet-portrait\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 800, height: 1280 }, hasTouch: true }
    },
    {
      name: 'mobile-landscape',
      testIgnore: /tablet-portrait\.spec\.ts/,
      use: { ...devices['Pixel 7'], viewport: { width: 844, height: 390 } }
    }
  ]
});
