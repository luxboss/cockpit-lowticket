import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5530,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3531',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 5530,
    host: '127.0.0.1',
  },
});
