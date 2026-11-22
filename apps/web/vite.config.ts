import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env.CARDOPS_API_TARGET ?? 'http://127.0.0.1:8787';
const scanTarget = process.env.CARDOPS_SCAN_TARGET ?? 'http://127.0.0.1:8791';
const wsTarget = process.env.CARDOPS_WS_TARGET ?? 'http://127.0.0.1:8790';
const webPort = Number(process.env.WEB_PORT ?? 5173);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: webPort,
    strictPort: true,
    proxy: {
      '/ocr-api': {
        target: scanTarget,
        changeOrigin: false,
        xfwd: true,
        rewrite: (path) => path.replace(/^\/ocr-api/, ''),
      },
      '/api': {
        target: apiTarget,
        changeOrigin: false,
        xfwd: true,
      },
      '/ws': {
        target: wsTarget,
        ws: true,
        changeOrigin: false,
        xfwd: true,
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/ocr-api': {
        target: scanTarget,
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/ocr-api/, ''),
      },
      '/api': { target: apiTarget, changeOrigin: false },
      '/ws': { target: wsTarget, ws: true, changeOrigin: false },
    },
  },
  build: {
    // Source maps are useful locally but should not be shipped by default.
    sourcemap: process.env.VITE_SOURCEMAP === 'true',
  },
});
