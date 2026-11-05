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
      // Toolchain symlinks and generated state can exhaust Linux file watchers. Agents' worktrees
      // (.claude) are whole checkouts: each change in one cleared the server's cache, and the dev
      // server ran out of memory.
      ignored: ['**/{.devenv,.direnv,.cache,.local,outputs,tmp,.claude}/**']
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
          // isolated-vm, which lays presentations out on the server, needs Node's snapshot off.
          execArgv: ['--no-node-snapshot'],
          // Tests that build real presentations take seconds on CI's slower machines; none should
          // fail on time alone.
          testTimeout: 30_000,
          // One browser for the browser tests' run, which each file connects to; idle otherwise.
          globalSetup: ['src/lib/modes/sverlin/testing/browser-setup.ts'],
          // A browser test that fails in CI runs once more, its trace kept (testing/browser.ts), so a
          // flaky test shows as one rather than passing unseen; locally a failure is a failure.
          retry: process.env.CI && process.env.SVERLIN_RUN_BROWSER_TESTS === '1' ? 1 : 0,
          include: ['src/**/*.{test,spec}.{js,ts}'],
          exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
        }
      }
    ]
  }
});
