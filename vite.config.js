import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub project Pages serves this repository under /skillswap/.
  // Local Vite development and other hosts keep the normal root path.
  base: process.env.GITHUB_ACTIONS ? '/skillswap/' : '/',
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:8788' }
  }
});
