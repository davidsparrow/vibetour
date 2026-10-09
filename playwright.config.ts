import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5177',
    viewport: { width: 1280, height: 760 },
    launchOptions: {
      // Software WebGL so the renderer runs in headless CI.
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 760 } } }],
  webServer: {
    // Build first so the e2e tests always exercise the current sources.
    command: 'node scripts/build.mjs && node scripts/serve-demo.mjs',
    url: 'http://127.0.0.1:5177/',
    env: { PORT: '5177' },
    reuseExistingServer: !process.env.CI,
  },
});
