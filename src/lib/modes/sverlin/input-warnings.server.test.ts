import { describe, expect, it } from 'vitest';

import { prepareSvelteComponent } from './compile.server';
import { bundlePresentation } from './testing/scenes';
import search from './fixtures/search-at.sverlin?raw';

// Project 84017f9e's shape: the lists a run of merge sort makes, typed into the case as strings and
// drawn beside the run, which never reads them.
const typedIn = search
  .replace(
    'const Index = index(Values);',
    "const Index = index(Values);\n  const Part = type(['3 8 15', '23 42']);\n  const Parts = array(Part, { max: 2 });"
  )
  .replace('const target = Int;', 'const target = Int;\n  const parts = Parts;')
  .replace(
    '<View of="Index" name="IndexNumber">',
    '<View of="Part" name="PartCell"><Node value={this} /></View>\n<View of="Index" name="IndexNumber">'
  )
  .replace('target={42} />', "target={42} parts={['3 8 15', '23 42']} />")
  .replace(
    '<Layout name="Main" of="lo, hi, values">',
    '<Layout name="Main" of="lo, hi, values, parts">'
  )
  .replace(
    '<Bounds lo={lo} hi={hi} />',
    '<Bounds lo={lo} hi={hi} />\n    {#each parts as part}{part}{/each}'
  )
  .replace(
    '<Main lo={lo} hi={hi} values={values} />',
    '<Main lo={lo} hi={hi} values={values} parts={parts} />'
  );

describe('inputs the view draws but nothing reads', () => {
  it('warn of one typed into the case, as its picture does not come from the run', async () => {
    const { warnings } = await bundlePresentation(prepareSvelteComponent(typedIn), 1);
    expect(warnings).toContainEqual(
      expect.stringMatching(/^The view draws the input parts, but the algorithm never reads it/u)
    );
  });

  it('warn of none the algorithm reads', async () => {
    const { warnings = [] } = await bundlePresentation(prepareSvelteComponent(search), 1);
    expect(warnings.filter((warning) => warning.includes('never reads it'))).toEqual([]);
  });
});
