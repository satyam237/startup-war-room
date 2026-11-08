/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * onnxruntime-web names its wasm with `new URL(..., import.meta.url)`, so Vite copies 21.6 MB into dist. At runtime
 * transformers.js points the runtime at jsDelivr (measured: the wasm came from cdn.jsdelivr.net), so the copy is
 * never fetched. Leave it out of the deploy.
 */
const dropUnusedOrtWasm = (): Plugin => ({
  name: 'drop-unused-ort-wasm',
  generateBundle(_, bundle) {
    for (const name of Object.keys(bundle)) if (/ort-wasm[^/]*\.wasm$/.test(name)) delete bundle[name]
  },
})

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The HD voice worker (kokoro.worker.ts) is a module worker; its dependencies use import.meta and dynamic imports.
  worker: { format: 'es', plugins: () => [dropUnusedOrtWasm()] },
  server: { proxy: { '/debates': 'http://localhost:8000' } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    css: false,
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
