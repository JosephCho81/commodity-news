import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'), // 보통 src 폴더를 가리킵니다.
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  }
});
