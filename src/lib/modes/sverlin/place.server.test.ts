import { describe, expect, it } from 'vitest';

import { prepareSvelteComponent } from './compile.server';
import { keptKey, writtenKey } from './library/node/design-keys';
import { drawnSteps, ofKind } from './testing/scenes';
import { placeWarningCodes } from './place-checks.server';

// A binary search whose three pointers share one pointer view, each captioned by place().
const search = (mark: string, array: string, page: string) =>
  `<script domain>
  const Int = type('integer', { min: 0, max: 99 });
  const Values = array(Int, { max: 8 });
  const Index = index(Values);
</script>
<script input>
  const values = Values;
  const target = Int;
</script>
<Case name="main" values={[3, 8, 15, 23, 42, 57, 71]} target={42} />
<script algorithm>
  @range[let lo = Index(0);
  let hi = values.length - 1;]
  while (@open[lo <= hi]) @probe{
    @mid[const mid = Index(Math.floor((lo + hi) / 2));]
    if (@low[values[mid] < target]) @right[lo = mid + 1;]
    else @left[hi = mid - 1;]
  }
</script>
<View of="Int" name="IntCell"><Node value={this} /></View>
${array}
<View of="Index" name="Arrow"><Node layout="column"><Link to={this} /><Node kind="Tip" icon /><Node kind="Caption">${mark}</Node></Node></View>
<Layout name="Main" of="lo, hi, mid, values">
  <Node layout="row">
    ${page}
    {lo}
    {hi}
    {mid}
  </Node>
</Layout>
<Storyboard>
  <Scene name="main" case="main" pause="@range, @probe.mid"><Main /></Scene>
</Storyboard>`;
const asView =
  '<View of="Values" name="Cells"><Node layout="row">{#each this as v}{v}{/each}</Node></View>';
const asLayout =
  '<Layout name="Cells" of="values"><Node layout="row">{#each values as v}{v}{/each}</Node></Layout>';
const captions = (step: Parameters<typeof ofKind>[0]) =>
  ofKind(step, 'Arrow.Caption').map(({ text }) => text);

describe('place() in a pointer view', () => {
  it('captions every pointer one view draws with its own place, or the label the design gives it', async () => {
    const source = search('{place()}', asView, '{values}');
    const named = await drawnSteps(source);
    // At the first probe all three are drawn, each with its own name.
    expect(captions(named.steps[2]).sort()).toEqual(['hi', 'lo', 'mid']);
    const labelled = await drawnSteps(source, {
      chosen: { ':lo.label': 'low', ':hi.label': 'high', ':mid.label': 'middle' }
    });
    expect(captions(labelled.steps[2]).sort()).toEqual(['high', 'low', 'middle']);
    expect(
      (labelled.built.warnings ?? []).filter(({ code }) => !placeWarningCodes.has(code))
    ).toEqual([]);
  });

  it('keeps each pointer the room it needs, as one view for each would', async () => {
    const shared = await drawnSteps(search('{place()}', asView, '{values}'));
    const own = (name: string) =>
      `<View of="Index" name="${name}"><Node layout="column"><Link to={this} /><Node kind="Tip" icon /><Node kind="Caption">{place()}</Node></Node></View>`;
    const apart = await drawnSteps(
      search('{place()}', `${asView}\n${own('ArrowB')}\n${own('ArrowC')}`, '{values}'),
      {
        chosen: {
          'views.Index:lo': 'Arrow',
          'views.Index:hi': 'ArrowB',
          'views.Index:mid': 'ArrowC'
        }
      }
    );
    const height = (step: Parameters<typeof ofKind>[0]) => ofKind(step, 'Cells')[0]?.box.height;
    expect(height(shared.steps[2])).toBe(height(apart.steps[2]));
  });

  it('marks the same items whether the array is drawn by a view or by a layout', async () => {
    const byView = await drawnSteps(search('{place()}', asView, '{values}'));
    const byLayout = await drawnSteps(search('{place()}', asLayout, '<Cells />'));
    const marks = (step: Parameters<typeof ofKind>[0]) =>
      step.nodes
        .filter(({ kind }) => kind === 'Arrow.Pointed' || kind === 'Arrow.Tip')
        .map(({ kind, box }) => `${kind}@${Math.round(box.x)}`);
    byView.steps.forEach((step, k) => expect(marks(step)).toEqual(marks(byLayout.steps[k])));
  });

  it('is refused outside a view, and with anything given', () => {
    const outside = search('lo', asView, '{values}<Node>{place()}</Node>');
    expect(() => prepareSvelteComponent(outside)).toThrow(
      expect.objectContaining({
        code: 'view_name',
        message: expect.stringContaining('so it is written only in a <View>')
      })
    );
    expect(() => prepareSvelteComponent(search('{place(1)}', asView, '{values}'))).toThrow(
      expect.objectContaining({
        code: 'view_name',
        message: expect.stringContaining('takes nothing')
      })
    );
  });

  it("captions a label's place by the label's last name, or the design's caption for :@…", async () => {
    // The probe's comparison labels the position it reads, @probed, drawn as a pointer.
    const source = search('{place()}', asView, '{values}{@probe.low.probed}')
      .replace('if (@low[values[mid] < target])', 'if (@low[values[@probed[mid]] < target])')
      .replace('of="lo, hi, mid, values"', 'of="lo, hi, mid, values, @probe.low.probed"')
      .replace('pause="@range, @probe.mid"', 'pause="@range, @probe.mid, @probe.low"');
    const named = await drawnSteps(source);
    const atCheck = named.steps.find((step) => captions(step).includes('probed'));
    expect(atCheck).toBeDefined();
    expect(captions(atCheck!)).not.toContain('probe.low.probed');
    const { space } = prepareSvelteComponent(source).design;
    expect(space[':@probe.low.probed.label']).toEqual(['probed']);
    expect(space['Arrow.Link:@probe.low.probed.targetFill']).toBeDefined();
    const labelled = await drawnSteps(source, {
      chosen: { ':@probe.low.probed.label': 'checked' }
    });
    expect(labelled.steps.some((step) => captions(step).includes('checked'))).toBe(true);
  });

  it('writes a place label as :lo.label and keeps it as :lo.label', () => {
    expect(writtenKey(':lo.label')).toBe(':lo.label');
    expect(keptKey(':lo.label')).toBe(':lo.label');
    expect(keptKey(':pair.left.label')).toBe(':pair.left.label');
    expect(writtenKey(':pair.left.label')).toBe(':pair.left.label');
  });
});
