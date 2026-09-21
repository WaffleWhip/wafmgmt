import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    port: 80,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true
      },
      '/ssh': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true
      },
      '/logo': 'http://localhost:3000'
    }
  }
});
