import { defineConfig, devices } from '@playwright/test'

// E2E del flujo de registrar una sesión contra un Supabase simulado (tests/e2e/mock-supabase.ts)
// y la app compilada en modo producción (con service worker). Requiere `npm run build` antes.
const APP_PORT = 3100
const MOCK_PORT = 54321

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    ...devices['Pixel 7'],
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : undefined,
  },
  webServer: [
    {
      command: `node tests/e2e/mock-supabase.ts ${MOCK_PORT}`,
      url: `http://localhost:${MOCK_PORT}/__state`,
      reuseExistingServer: false,
    },
    {
      command: 'node .output/server/index.mjs',
      url: `http://localhost:${APP_PORT}/api/health`,
      reuseExistingServer: false,
      env: {
        PORT: String(APP_PORT),
        VITE_SUPABASE_URL: `http://localhost:${MOCK_PORT}`,
        VITE_SUPABASE_ANON_KEY: 'e2e-anon-key',
        SUPABASE_SERVICE_ROLE_KEY: 'e2e-service-key',
        // Entrenador IA contra el simulador de Gemini del mock (nunca la API real).
        AI_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'e2e-gemini-key',
        GEMINI_BASE_URL: `http://localhost:${MOCK_PORT}/gemini/v1beta`,
        GEMINI_FALLBACK_MODEL: 'gemini-e2e-fallback',
        AI_DAILY_LIMIT: '5',
      },
    },
  ],
})
