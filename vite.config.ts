import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { serviceWorkerPlugin } from './scripts/vite-sw-plugin.ts'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tailwindcss(),
    // tanstackStart must come before the React plugin.
    tanstackStart(),
    // Nitro auto-detects Vercel at build time (VERCEL env var) and emits .vercel/output.
    // maxDuration: generating an AI plan can take ~1 min (within Vercel Hobby limits).
    nitro({ vercel: { functions: { maxDuration: 60 } } }),
    viteReact(),
    serviceWorkerPlugin({ template: 'src/sw/sw.js', publicDir: 'public' }),
  ],
})
