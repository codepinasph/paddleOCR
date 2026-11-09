import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  preview: { proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true } } },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true, timeout: 610000 } }
  }
});
