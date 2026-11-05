/**
 * Vitest global setup for the browser tests: one Chromium for the whole run, which each test file
 * connects to (testing/browser.ts), rather than a browser launched in every file. Does nothing
 * unless the browser tests are on (SVERLIN_RUN_BROWSER_TESTS=1, which `pnpm run test:browser` sets).
 */

import { chromium } from 'playwright-core';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    browserEndpoint: string;
  }
}

export default async function setup(
  project: TestProject
): Promise<(() => Promise<void>) | undefined> {
  if (process.env.SVERLIN_RUN_BROWSER_TESTS !== '1') return;
  // The session's library path can hold libraries of another package set than the browser's.
  const env = { ...process.env } as Record<string, string>;
  delete env.LD_LIBRARY_PATH;
  const server = await chromium.launchServer({
    executablePath: process.env.SVERLIN_TEST_BROWSER,
    env
  });
  project.provide('browserEndpoint', server.wsEndpoint());
  return () => server.close();
}
