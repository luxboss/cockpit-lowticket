import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5550,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:3551',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 5550,
    host: '127.0.0.1',
  },
});
