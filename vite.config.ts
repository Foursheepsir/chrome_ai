import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        // Disable code splitting for content scripts to avoid dynamic import issues
        manualChunks: undefined
      }
    }
  }
})
