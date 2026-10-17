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
      output: {
        // Keep shared controls, projections and effects together. Entry points
        // and MapLibre stay separate, so Netgraph never loads the basemap.
        codeSplitting: { groups: [
          { name: 'terminal', test: /[\\/]src[\\/]terminal(?:Grid)?\.ts$/, priority: 20 },
          { name: 'shared', test: /[\\/]src[\\/]/, minShareCount: 2 },
        ] },
      },
      input: {
        main: inputPath('index.html'),
        netgraph: inputPath('netgraph/index.html')
      }
    }
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts']
  }
});
