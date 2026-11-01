import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', workers: 1, retries: 0,
  timeout: 120000, globalTimeout: 600000,
  expect: { timeout: 15000 },
  reporter: [['list'], ['./tests/report.js']],
  use: {
    browserName: 'chromium', viewport: { width: 1440, height: 1000 },
    launchOptions: { args: ['--enable-unsafe-swiftshader'] },
    screenshot: 'only-on-failure', trace: 'retain-on-failure'
  }
});
