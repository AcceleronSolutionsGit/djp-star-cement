import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // `timeout` bounds the INCOMING request; `proxyTimeout` bounds how long we
        // wait on the API. Only the first was set, so a long generation was cut off
        // upstream and the browser received a dead socket — which surfaced as
        // "... is not valid JSON" from res.json(). Both are needed.
        timeout: 30 * 60 * 1000,
        proxyTimeout: 30 * 60 * 1000
      }
    }
  },
  build: {
    outDir: '../admin-panel',
    emptyOutDir: false
  }
});
