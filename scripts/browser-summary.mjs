// Writes test-results/browser-summary.txt from the browser run's JSON report: the counts and the
// failing tests' names, so a run's outcome can be read without its output.
import { readFileSync, writeFileSync } from 'node:fs';

const report = 'test-results/browser.json';
let lines;
try {
  const { numPassedTests, numFailedTests, numPendingTests, testResults } = JSON.parse(
    readFileSync(report, 'utf8')
  );
  const failed = testResults.flatMap(({ name, assertionResults }) =>
    assertionResults
      .filter(({ status }) => status === 'failed')
      .map(({ fullName }) => `${name.replace(/^.*\/src\//u, 'src/')}: ${fullName}`)
  );
  lines = [
    `passed ${numPassedTests}, failed ${numFailedTests}, skipped ${numPendingTests}`,
    ...failed.map((name) => `FAIL ${name}`)
  ];
} catch {
  lines = [`no report at ${report}: the run stopped before it finished (timed out or crashed)`];
}
writeFileSync('test-results/browser-summary.txt', `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
