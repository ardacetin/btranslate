import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The admin panel (/host) is a React + BoardUI app. It builds into
// frontend/panel/, which Express serves as static files — the server itself
// needs no build tools (the output is committed).
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/static/panel/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: fileURLToPath(new URL('../frontend/panel', import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  server: {
    // `npm run dev:panel` → http://localhost:5173/static/panel/ with the API
    // and WebSockets proxied to a locally running `npm run dev` (port 3000).
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
