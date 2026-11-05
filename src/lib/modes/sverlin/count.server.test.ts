import { describe, expect, it } from 'vitest';

import { bundlePresentation, prepareSvelteComponent } from './compile.server';
import dotsFixture from './fixtures/count-dots.sverlin?raw';

/** The dots fixture with its count's largest value, and its view, replaced. */
const withCount = (max: number, view?: string) => {
  const source = dotsFixture.replace('{ min: 0, max: 12 }', `{ min: 0, max: ${max} }`);
  return view ? source.replace(/<View of="Count" name="Dots">[\s\S]*?<\/View>/u, view) : source;
};

const problemOf = (source: string) => {
  try {
    prepareSvelteComponent(source);
  } catch (cause) {
    const error = cause as Error & { others?: Error[] };
    return [error, ...(error.others ?? [])].map(({ message }) => message).join('\n');
  }
  return '';
};

describe('{#each count(n) as k}', () => {
  it('draws one copy for each of 0 … n − 1, its grid sized for the largest count the type allows', async () => {
    const prepared = prepareSvelteComponent(dotsFixture);
    const { labels } = await bundlePresentation(prepared, 1, {});
    expect(labels.length).toBeGreaterThan(1);
    // Up to 12 dots in rows of five: rows 0 to 2 and columns 0 to 4, whatever the counts reached.
    const code = prepared.component.replace(/\s+/gu, '');
    expect(code).toContain('__extent:[[0,1,2],[0,1,2,3,4]]');
    expect(code).toContain('Array.from({length:Math.max(0,');
    expect(code).not.toMatch(/[^.\w]count\(/u);
  });

  it('draws a row of icons, each its kind’s, one for each of the count', async () => {
    const rating = withCount(
      12,
      '<View of="Count" name="Dots"><Node layout="row">{#each count(this) as k}<Node kind="Star" icon />{/each}</Node></View>'
    );
    const { labels } = await bundlePresentation(prepareSvelteComponent(rating), 1, {});
    expect(labels.length).toBeGreaterThan(1);
  });

  it('refuses a count past its limit, naming a bar instead', () => {
    expect(problemOf(withCount(120))).toContain(
      'count(…) goes up to 120, more than the 100 a view can draw one by one: draw a value this large as a length, as a bar with height={this}.'
    );
  });

  it('refuses a count of what has no integer type with a largest value', () => {
    expect(
      problemOf(
        withCount(
          12,
          '<View of="Count" name="Dots"><Node layout="row">{#each count(2 * this) as k}<Node kind="Dot">●</Node>{/each}</Node></View>'
        )
      )
    ).toContain('count(…) takes one value of an integer type with a largest value');
  });

  it('refuses count(…) anywhere but as the list an {#each} walks', () => {
    expect(
      problemOf(
        withCount(12, '<View of="Count" name="Dots"><Node value={count(this).length} /></View>')
      )
    ).toContain('count(…) is only the list an {#each} walks');
  });
});
