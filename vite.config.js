import { defineConfig } from 'vite';

export default defineConfig({
  // Rutas relativas para poder publicar en Netlify, Vercel, GitHub Pages o
  // cualquier subcarpeta sin tocar la configuración.
  base: './',
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 1600,
  },
});
