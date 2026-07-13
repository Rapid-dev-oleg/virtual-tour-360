import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: true,
    // allow the ngrok tunnel host to reach the dev server
    allowedHosts: true,
    // dev: proxy backend API + served files to the Express server
    proxy: {
      '/api': 'http://localhost:8787',
      '/uploads': 'http://localhost:8787',
    },
  },
  preview: {
    port: 4173,
    host: true,
    // allow the ngrok tunnel host to reach the preview server
    allowedHosts: true,
  },
});
