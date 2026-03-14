import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()], // tailwindcss() 플러그인을 여기서 제거합니다.
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
