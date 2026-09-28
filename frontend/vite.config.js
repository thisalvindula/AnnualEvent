import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

const root = fileURLToPath(new URL('.', import.meta.url));

function entry(relPath) {
  return fileURLToPath(new URL(relPath, import.meta.url));
}

export default defineConfig({
  root,
  plugins: [preact()],
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom/test-utils': 'preact/test-utils',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'raffle-register': entry('raffle/register/index.html'),
        'raffle-screen': entry('raffle/screen/index.html'),
        'voting-vote': entry('voting/vote/index.html'),
        'voting-screen': entry('voting/screen/index.html'),
        'admin-login': entry('admin/login/index.html'),
        'admin-dashboard': entry('admin/dashboard/index.html'),
        'admin-lists': entry('admin/lists/index.html'),
        'admin-raffle': entry('admin/raffle/index.html'),
        'admin-vote': entry('admin/vote/index.html'),
      },
    },
  },
  server: {
    proxy: {
      '/raffle/api': 'http://localhost:3000',
      '/vote/api': 'http://localhost:3000',
      '/admin': 'http://localhost:3000',
      '/screen': { target: 'http://localhost:3000', ws: false },
      '/static': 'http://localhost:3000',
      '/api': 'http://localhost:3000',
    },
  },
});
