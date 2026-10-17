import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import type { HmrContext, Plugin } from 'vite';

function MDHmr(): Plugin {
  return {
    name: 'static-hmr',
    enforce: 'post' as const,
    handleHotUpdate({ file, server }: HmrContext) {
      if (file.includes('static/')) {
        server.ws.send({
          type: 'full-reload',
          path: '*'
        });
      }
    }
  };
}

export default defineConfig({
  cacheDir: '.cache/vite',
  plugins: [tailwindcss(), sveltekit(), MDHmr()],
  // Loaded only when a PDF is exported, so without this the dev server would find it then and
  // reload the page, cancelling that export.
  optimizeDeps: { include: ['jspdf'] },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    watch: {
      // Toolchain symlinks and generated state can exhaust Linux file watchers.
      ignored: ['**/{.devenv,.direnv,.cache,.local,outputs,tmp}/**']
    },
    sourcemapIgnoreList(sourcePath) {
      return sourcePath.includes('node_modules');
    }
  },
  test: {
    expect: { requireAssertions: true },
    projects: [
      {
        extends: './vite.config.ts',
        test: {
          name: 'server',
          environment: 'node',
          include: ['src/**/*.{test,spec}.{js,ts}'],
          exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
        }
      }
    ]
  }
});
