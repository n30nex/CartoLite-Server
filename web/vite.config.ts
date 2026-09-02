import { defineConfig } from 'vitest/config';

function inputPath(relative: string): string {
  const pathname = decodeURIComponent(new URL(relative, import.meta.url).pathname);
  return /^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1) : pathname;
}

export default defineConfig({
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 500,
    rolldownOptions: {
      input: {
        main: inputPath('index.html')
      }
    }
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts']
  }
});
