// Tests de bout en bout de Venus, dans un vrai navigateur, sur ordinateur et sur téléphone.
//   cd tests && npm ci && npx playwright install chromium && npm test
// L'interface Next.js doit être construite avant (npm run web:build à la racine).
import { defineConfig, devices } from '@playwright/test';

const port = process.env.VENUS_TEST_PORT || '18765';
process.env.VENUS_TEST_PORT = port;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.mjs',
  globalTeardown: './e2e/global-teardown.mjs',
  // Un seul serveur partagé : les tests passent l'un après l'autre
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    // Machine sans accès au téléchargement des navigateurs : VENUS_CHROMIUM=/chemin/vers/chrome
    ...(process.env.VENUS_CHROMIUM ? { launchOptions: { executablePath: process.env.VENUS_CHROMIUM } } : {}),
    baseURL: `http://127.0.0.1:${port}`,
    storageState: './.auth.json',
    locale: 'fr-FR',
    timezoneId: 'Indian/Mayotte',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'ordinateur', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 820 } }, testIgnore: /television\.spec/ },
    { name: 'telephone', use: { ...devices['Pixel 7'] }, testMatch: /pages\.spec/ },
    { name: 'television', use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } }, testMatch: /television\.spec/ },
  ],
});
