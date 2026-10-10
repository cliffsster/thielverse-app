import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'es2022' }, // main.js uses top-level await
});
