import { describe, expect, it } from 'vitest';

import { bundlePresentation as bundleOnBase, prepareSvelteComponent } from './compile.server';
import { linearSearchSource } from './contract';
import bst from './fixtures/bst.sverlin?raw';
import pseudocode from './fixtures/listing-pseudocode.sverlin?raw';
import bfs from './fixtures/bfs-visit-order.sverlin?raw';
import undirected from './fixtures/bfs-undirected.sverlin?raw';
import dijkstraFields from './fixtures/dijkstra-fields.sverlin?raw';
import { forms } from './library/node/forms';
import {
  buildVariant as buildOnBase,
  DesignValueError,
  withStarterBase,
  type VariantRequest
} from './design.server';
import { starterBase } from './library/node/starter-base';
import { onStarterBase } from './testing/scenes';

// Each request on the starter base where it names none, as every design in the app names one.
const buildVariant = (
  offered: Parameters<typeof buildOnBase>[0],
  start: Parameters<typeof buildOnBase>[1],
  request: VariantRequest,
  ...rest: Parameters<typeof buildOnBase> extends [unknown, unknown, unknown, ...infer R]
    ? R
    : never
) => buildOnBase(offered, start, onStarterBase(request), ...rest);
const bundlePresentation = (
  component: Parameters<typeof bundleOnBase>[0],
  seed: number,
  request: VariantRequest = {},
  options?: Parameters<typeof bundleOnBase>[3]
) => bundleOnBase(component, seed, onStarterBase(request), options);

const prepared = prepareSvelteComponent(linearSearchSource);
const { space, starter } = prepared.design;

describe('design space', () => {
  it('has every view of each type rendered by name, the layout’s frame, and every prop of every kind', () => {
    expect(space['views.Int']).toEqual(['IntCell', 'IntTally', 'none']);
    expect(space['views.Index']).toEqual(['Highlight', 'none']);
    expect(space['Main.ratio']).toContain('4:3');
    const kinds = new Set(
      Object.keys(space)
        .filter(
          (key) =>
            !key.startsWith('views.') &&
            !key.startsWith('views.') &&
            !key.startsWith('<') &&
            !key.startsWith('$') &&
            key !== 'layout' &&
            !key.startsWith('Main.') &&
            !/[:=@]/u.test(key) &&
            !/\.(from|hue|order|unit)$/u.test(key)
        )
        .map((key) => key.slice(0, key.lastIndexOf('.')))
    );
    expect([...kinds].sort()).toEqual(
      [
        'Title',
        'Caption',
        'Ask',
        'Checking',
        'Result',
        'IntCell',
        'IntTally',
        'IntTally.Tally',
        'Checking.Number',
        'Result.Number',
        'Highlight',
        'Highlight.<Link>',
        'Highlight.<Link>.<To>',
        'Highlight.Name',
        'Row',
        'Row.Under'
      ].sort()
    );
    // A layout's props, and a link's target paint.
    expect(space['Row.gap']).toBeDefined();
    expect(space['IntCell.gap']).toBeUndefined();
    expect(space['Highlight.<Link>.<To>.fill']).toContain('amber-100');
    // No overflow: a collection's tracks past its ends are no choice. Dashed borders are paint, for
    // any node.
    expect(space['IntTally.Tally.overflow']).toBeUndefined();
    expect(space['Row.overflow']).toBeUndefined();
    expect(space['IntCell.overflow']).toBeUndefined();
    expect(space['IntCell.strokeStyle']).toEqual(['solid', 'dashed', 'dotted']);
  });

  it('records the kind of each tag, by its line and column', () => {
    const lines = linearSearchSource.split('\n');
    const line = lines.findIndex((text) => text.includes('<Link to={this}'));
    const position = `${line + 1}:${lines[line].indexOf('<Link') + 1}`;
    expect(prepared.design.tags[position]).toEqual(['Highlight.<Link>']);
  });

  it('starts every variable at the starter, each type in its first view', () => {
    // What a kind inherits and a role's style in a base, as <Value>.fill, are set only where a
    // variant sets them.
    expect(Object.keys(starter).sort()).toEqual(
      Object.keys(space)
        .filter((key) => !key.startsWith('<') && !key.endsWith('.inherit'))
        .sort()
    );
    expect(starter['views.Int']).toBe('IntCell');
    for (const [key, value] of Object.entries(starter)) expect(space[key]).toContain(value);
  });
});

describe('variants', () => {
  it('takes chosen values, keeps a base where it fits, and gives the rest the starter', () => {
    const { values, origins, dropped } = buildVariant(
      space,
      starter,
      {
        chosen: { 'views.Int': 'IntTally' },
        base: { 'IntCell.radius': 999, 'IntCell.fill': 'not-a-colour', gone: 1 }
      },
      1
    );
    expect(values['views.Int']).toBe('IntTally');
    expect(origins['views.Int']).toBe('chosen');
    expect(values['IntCell.radius']).toBe(999);
    expect(origins['IntCell.radius']).toBe('kept');
    expect(values['IntCell.fill']).toBe(starter['IntCell.fill']);
    expect(origins['IntCell.fill']).toBe('starter');
    expect(values).not.toHaveProperty('gone');
    // A base value outside its variable's options is said; a variable the source lost goes quietly.
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toContain('IntCell.fill');
    expect(dropped[0]).toContain('not-a-colour');
    expect(dropped[0]).toContain('The value kept from the version built on is left out');
    expect(dropped[0]).toMatch(/The picture is drawn as it is\.$/u);
  });

  it('names the kind meant where a value names a kind by its last part only, and lists no token as a kind', () => {
    const nested = { ...space, 'Main.Board.AtI.fill': ['none', 'sky-100'] };
    const [why] = buildVariant(
      nested,
      starter,
      { chosen: { 'Main.AtI.fill': 'sky-100' } },
      1
    ).dropped;
    expect(why).toContain(
      'The design has no variable Main.AtI.fill (no kind Main.AtI: did you mean Main.Board.AtI.fill?); its kinds of node are'
    );
    expect(why).toContain('Main.Board.AtI');
    expect(why).not.toMatch(/\$\w/u);
    expect(why).toMatch(/The value is left out\.$/u);
  });

  it('rejects a chosen value outside its options, and leaves out one for no variable, saying why', () => {
    expect(() => buildVariant(space, starter, { chosen: { 'IntCell.radius': 3 } }, 1)).toThrow(
      DesignValueError
    );
    expect(() => buildVariant(space, starter, { chosen: { 'IntCell.radius': 3 } }, 1)).toThrow(
      'IntCell.radius cannot be 3'
    );
    const depth = buildVariant(space, starter, { chosen: { 'IntCell.depth': 1 } }, 1);
    expect(depth.values).not.toHaveProperty('IntCell.depth');
    expect(depth.dropped).toEqual([expect.stringContaining('IntCell has no prop depth')]);
    // A view choice for a place the source has not is no variable, not a prop of "pointers".
    expect(
      buildVariant(space, starter, { chosen: { 'views.Index:found': 'Arrow' } }, 1).dropped
    ).toEqual([
      expect.stringContaining(
        'The design has no variable {Index}:found; its view choices are {Int}'
      )
    ]);
  });

  it('leaves out a place setting what takes room, which holds for its kind at every step', () => {
    expect(space).not.toHaveProperty('Highlight.Name:found.padding');
    expect(space).toHaveProperty('Highlight.Name.padding');
    expect(
      buildVariant(space, starter, { chosen: { 'Highlight.Name:found.padding': 0.5 } }, 1).dropped
    ).toEqual([
      'A place sets only its paint (fill, stroke, color) and whether it is shown, never how much room anything takes: padding holds for every Highlight.Name at every step, as Highlight.Name.padding. The value is left out.'
    ]);
    expect(
      Object.keys(space)
        // A view chosen per place holds at every step, as a type's does; the rest are a place's looks.
        .filter((key) => /@[^.]/u.test(key) && !key.startsWith('views.'))
        .map((key) => key.slice(key.lastIndexOf('.') + 1))
        .filter((prop) => !['unit', 'true', 'false', 'from', 'order', 'hue'].includes(prop))
        .every((prop) => ['shown', 'fill', 'stroke', 'color'].includes(prop))
    ).toBe(true);
  });

  it('keeps a place as its kinds are until a variant sets it apart', () => {
    const { fallbacks } = prepared.design;
    const [first, second] = space['Highlight.<Link>.<To>.fill'].filter(
      (option) => option !== 'none' && option !== starter['Highlight.<Link>.<To>.fill']
    );
    // A place follows the kind it falls back to.
    const followed = buildVariant(
      space,
      starter,
      { chosen: { 'Highlight.<Link>.<To>.fill': first } },
      1,
      fallbacks
    ).values;
    expect(followed['Highlight.<Link>.<To>:found.fill']).toBe(first);
    // Chosen, it is set apart, and stays so as the kind changes.
    const apart = buildVariant(
      space,
      starter,
      { chosen: { 'Highlight.<Link>.<To>:found.fill': second } },
      1,
      fallbacks
    ).values;
    expect(apart['Highlight.<Link>.<To>:found.fill']).toBe(second);
    expect(apart['Highlight.<Link>.<To>:i.fill']).toBe(starter['Highlight.<Link>.<To>.fill']);
    const kept = buildVariant(
      space,
      starter,
      { base: apart, chosen: { 'Highlight.<Link>.<To>.fill': first } },
      1,
      fallbacks
    ).values;
    expect(kept['Highlight.<Link>.<To>:found.fill']).toBe(second);
    expect(kept['Highlight.<Link>.<To>:i.fill']).toBe(first);
  });

  it('randomises keeping equalities, shades, and what is shown or none', () => {
    const variants = Array.from(
      { length: 8 },
      (_, seed) => buildVariant(space, starter, { randomise: true }, seed + 1).values
    );
    for (const values of variants) {
      // Every kind that shared the starter's text colour still shares one.
      const colours = Object.entries(values)
        .filter(([key]) => key.endsWith('.color') && starter[key] === starter['IntCell.color'])
        .map(([, value]) => value);
      expect(new Set(colours).size).toBe(1);
      expect(colours[0]).toBe('black');
      expect(values['Row.Under.shown']).toBe(true);
      expect(values['Row.fill']).toBe('none');
      expect(values['views.Int']).not.toBe('none');
    }
    expect(
      new Set(variants.map((values) => values['Highlight.<Link>.<To>.fill'])).size
    ).toBeGreaterThan(1);
    expect(buildVariant(space, starter, { randomise: true }, 3).values).toEqual(variants[2]);
  });

  it('gives every kind of node the style props, drawn at random but for decoration', () => {
    expect(space['IntCell.shadow']).toEqual(['none', 'soft', 'lifted', 'hard']);
    expect(space['Highlight.Name.case']).toEqual(['normal', 'uppercase', 'small-caps']);
    expect(starter['Row.fillStyle']).toBe('solid');
    expect(() => buildVariant(space, starter, { chosen: { 'IntCell.glow': 'bright' } }, 1)).toThrow(
      'IntCell.glow cannot be "bright"'
    );
    const variants = Array.from(
      { length: 8 },
      (_, seed) => buildVariant(space, starter, { randomise: true }, seed + 1).values
    );
    for (const values of variants) expect(values['Title.decoration']).toBe('none');
    expect(new Set(variants.map((values) => values['IntCell.shadow'])).size).toBeGreaterThan(1);
  });

  it('randomises only the variables named', () => {
    const { values, origins } = buildVariant(
      space,
      starter,
      { randomise: ['views.Int'], base: { 'IntCell.radius': 999 } },
      2
    );
    expect(values['IntCell.radius']).toBe(999);
    expect(Object.entries(origins).filter(([, origin]) => origin === 'random').length).toBeLessThan(
      2
    );
  });

  it('bundles a presentation drawing its variant', async () => {
    const bundle = await bundlePresentation(prepared, 1, {
      chosen: { 'views.Int': 'IntTally', 'Row.Under.shown': false }
    });
    expect(bundle.variant['views.Int']).toBe('IntTally');
    expect(bundle.origins['Row.Under.shown']).toBe('chosen');
    expect(bundle.layoutCode).toContain('"views.Int":"IntTally"');
  });
});

describe('free layouts', () => {
  const tree = prepareSvelteComponent(bst).design;
  const graph = prepareSvelteComponent(bfs).design;

  it('give the kind arranging one its form, direction, curve, and layout seed', () => {
    // A tree takes every form but layered, which only layers take (layered-engine.ts).
    expect(tree.space['Tree.form']).toEqual(forms.filter((form) => form !== 'layered'));
    expect(graph.space['Graph.form']).toEqual(forms);
    expect(tree.space['Tree.curve']).toEqual(['straight', 'curved']);
    expect(tree.space['Tree.layoutSeed']).toContain(1);
    expect(tree.starter).toMatchObject({
      'Tree.form': 'natural',
      'Tree.curve': 'straight',
      'Tree.layoutSeed': 1
    });
    // Every structure runs right unless a variant says, a tree too.
    expect(tree.space['Tree.direction']).toEqual(['down', 'right']);
    expect(graph.space['Graph.direction']).toEqual(['down', 'right']);
    expect(graph.starter['Graph.direction']).toBe('right');
    // Rows and columns have no such look.
    expect(Object.keys(space).filter((key) => key.endsWith('.form'))).toEqual([]);
    expect(Object.keys(tree.space).filter((key) => key.endsWith('.form'))).toEqual(['Tree.form']);
  });

  it('keep the layout of the variant built on unless a value changes it', () => {
    const base = { ...tree.starter, 'Tree.form': 'wave', 'Tree.layoutSeed': 7 };
    const paced = buildVariant(tree.space, tree.starter, { base, chosen: {} }, 99).values;
    expect(paced).toMatchObject({ 'Tree.form': 'wave', 'Tree.layoutSeed': 7 });
    const contrasted = buildVariant(
      tree.space,
      tree.starter,
      { base, chosen: { 'Tree.form': 'snake' } },
      99
    ).values;
    expect(contrasted).toMatchObject({ 'Tree.form': 'snake', 'Tree.layoutSeed': 7 });
    // A form that is none of them is refused, naming them.
    expect(() =>
      buildVariant(tree.space, tree.starter, { chosen: { 'Tree.form': 'spiral' } }, 1)
    ).toThrow(DesignValueError);
  });

  it('give a link’s kind its route, head, and head size, which a vary keeps', () => {
    expect(graph.space['Graph.<Link>.route']).toEqual(['layout', 'straight', 'curved', 'wire']);
    expect(graph.space['Graph.<Link>.<To>.head']).toEqual([
      'none',
      'arrow',
      'open',
      'vee',
      'dot',
      'diamond',
      'bar'
    ]);
    expect(graph.space['Graph.<Link>.headSize']).toEqual([6, 9, 12, 16]);
    expect(graph.space['Graph.<Link>.curve']).toBeUndefined();
    expect(graph.space['Graph.<Link>.color']).toBeUndefined();
    expect(graph.starter).toMatchObject({
      'Graph.<Link>.route': 'layout',
      'Graph.<Link>.<To>.head': 'arrow',
      'Graph.<Link>.headSize': 9
    });
    const base = {
      ...graph.starter,
      'Graph.<Link>.route': 'wire',
      'Graph.<Link>.<To>.head': 'vee'
    };
    expect(buildVariant(graph.space, graph.starter, { base }, 5).values).toMatchObject({
      'Graph.<Link>.route': 'wire',
      'Graph.<Link>.<To>.head': 'vee'
    });
  });

  it('start a link’s head at none where every link of its kind is a two-way line', () => {
    expect(prepareSvelteComponent(undirected).design.starter).toMatchObject({
      'Graph.<Link>.<To>.head': 'none'
    });
    expect(prepareSvelteComponent(bfs).design.starter).toMatchObject({
      'Graph.<Link>.<To>.head': 'arrow'
    });
  });
});

describe('design tokens and role styles', () => {
  // IntCell and IntDot are values, Cells a container and Note a text, all made by <Node>;
  // Arrow.<Link> is a link, made by <Link>; `{v}` is a place, IntCell:v.
  const levelled = prepareSvelteComponent(
    `<script domain>const Int = type([1, 3]); const Values = array(Int, { max: 8 }); const Position = index(Values);</script><script input>const values = Values;</script><Case name="main" values={[1, 3]} /><script algorithm>@run[let i = Position(0); let j = Position(1);]</script><View of="Int" name="IntCell"><Node value={this} /></View>\n<View of="Int" name="IntDot"><Node value={this} /></View>\n<View of="Position" name="Arrow"><Node layout="column"><Link to={this} /><Node kind="Name">i</Node></Node></View>\n<Layout name="Cells"><Node layout="row">{#each values as v}{v}{/each}</Node></Layout><Layout name="Note"><Node>note</Node></Layout><Layout name="Main"><Node><Cells />{i}<Note /></Node></Layout><Storyboard><Scene name="main" case="main"><Main /></Scene></Storyboard>`
  ).design;
  const build = (request: Parameters<typeof buildVariant>[2]) =>
    buildVariant(levelled.space, levelled.starter, request, 1, levelled.fallbacks, levelled.roles)
      .values;

  it('starts every kind at its role look, which names the tokens it shares', () => {
    expect(levelled.starter['$spacing']).toBe(0.375);
    expect(levelled.space['<Value>.padding']).toContain('$spacing');
    expect(levelled.space['<Value>.shown']).toBeUndefined();
    expect(levelled.space['<Pointer>.<To>.fill']).toBeDefined();
    expect(levelled.space['<Value>.<To>.fill']).toBeUndefined();
    expect(levelled.roles['Arrow.<Link>.<To>']).toBe('pointer');
    expect(levelled.roles['Arrow.<Link>']).toBe('pointer');
    const values = build({});
    for (const [key, value] of Object.entries(levelled.starter)) expect(values[key]).toBe(value);
  });

  it('changes every kind following a token, and a role style overrides the token for its role', () => {
    const spacing = build({ chosen: { $spacing: 0.25 } });
    expect([spacing['IntCell.padding'], spacing['IntDot.padding']]).toEqual([0.25, 0.25]);
    expect(spacing['Cells.padding']).toBe(0);
    const styled = build({ chosen: { $spacing: 0.25, '<Value>.padding': 0.5 } });
    expect([styled['IntCell.padding'], styled['IntDot.padding'], styled['Note.padding']]).toEqual([
      0.5, 0.5, 0
    ]);
    const named = build({ chosen: { '<Text>.fill': '$highlight' } });
    expect([named['IntCell.fill'], named['Note.fill']]).toEqual(['white', 'amber-100']);
  });

  it('refuses the old spellings of built-in names, giving the new', () => {
    expect(() => build({ chosen: { '$Value.fill': 'white' } })).toThrow(
      /\$Value is written <Value>/u
    );
    expect(() => build({ chosen: { '<Node>.padding': 0.5 } })).toThrow(
      /<Node>\.padding: the <Node> group is gone; set the role styles <Container>, <Value>/u
    );
    expect(() => build({ chosen: { 'listing.syntax': 'colour' } })).toThrow(
      /listing is written <Listing>/u
    );
    expect(() => build({ chosen: { base: '$starter' } })).toThrow(
      /\$starter is written <starter>/u
    );
    expect(() => build({ chosen: { 'Arrow.Link.stroke': 'red-500' } })).toThrow(
      /Arrow\.Link\.stroke is written Arrow\.<Link>\.stroke/u
    );
    expect(() => build({ chosen: { 'Arrow.<Link>:i.targetFill': 'sky-100' } })).toThrow(
      /Arrow\.<Link>:i\.targetFill is written Arrow\.<Link>\.<To>:i\.fill/u
    );
  });

  it("keeps a kind's own value and a place's over its role style", () => {
    const own = build({ chosen: { '<Value>.padding': 0.5, 'IntCell.padding': 0.125 } });
    expect([own['IntCell.padding'], own['IntDot.padding']]).toEqual([0.125, 0.5]);
    const placed = build({ chosen: { '<Value>.fill': 'sky-100', 'IntCell:v.fill': 'rose-100' } });
    expect([placed['IntCell.fill'], placed['IntCell:v.fill']]).toEqual(['sky-100', 'rose-100']);
    // A place not set apart follows its kind, and so the role style.
    expect(build({ chosen: { '<Value>.fill': 'sky-100' } })['IntCell:v.fill']).toBe('sky-100');
    // A value set apart in the base stays when a token changes later.
    const base = build({ chosen: { 'IntCell.padding': 0.125 } });
    expect(build({ base, chosen: { $spacing: 0.5 } })['IntCell.padding']).toBe(0.125);
    expect(build({ base, chosen: { $spacing: 0.5 } })['IntDot.padding']).toBe(0.5);
  });

  it('refuses a token or a role style outside its options, naming them', () => {
    expect(() => build({ chosen: { $radius: 5 } })).toThrow(
      /\$radius cannot be 5; its options are 0, 2, 4, 6, 8, 12, 999/u
    );
    expect(() => build({ chosen: { '<Value>.padding': '$radius' } })).toThrow(
      /<Value>\.padding cannot be "\$radius"/u
    );
  });

  it('draws tokens with the kinds holding their value, so kinds following one stay alike', () => {
    const drawn = build({ randomise: true });
    expect(drawn['IntCell.padding']).toBe(drawn['$spacing']);
    expect(drawn['IntCell.color']).toBe(drawn['$text']);
  });

  it('takes the listing settings under <Listing>', () => {
    const { design } = prepareSvelteComponent(pseudocode);
    const chosen = { '<Listing>.syntax': 'colour' };
    const values = buildVariant(design.space, design.starter, { chosen }, 1).values;
    expect(values['<Listing>.syntax']).toBe('colour');
  });

  it('gives a kind what it inherits from a style, over its role style and token, under its own', () => {
    const styled = build({
      chosen: {
        $spacing: 0.25,
        '<Text>.padding': 0.5,
        '$cell.padding': 0.125,
        '$cell.radius': 2,
        'IntCell.inherit': '$cell',
        'IntDot.inherit': '$cell',
        'IntDot.radius': 999
      }
    });
    expect([styled['IntCell.padding'], styled['IntDot.padding']]).toEqual([0.125, 0.125]);
    // Its own value wins; a prop the style does not set comes from the role's style.
    expect([styled['IntCell.radius'], styled['IntDot.radius']]).toEqual([2, 999]);
    expect(styled['Note.padding']).toBe(0.5);
    // A style's value can name a token, which it then follows.
    const tokened = build({
      chosen: { '$cell.fill': '$highlight', 'IntCell.inherit': '$cell' }
    });
    expect(tokened['IntCell.fill']).toBe('amber-100');
    expect(levelled.starter['IntCell.inherit']).toBeUndefined();
  });

  it('gives a kind what it inherits from a kind of its role, after that kind settles', () => {
    const values = build({
      chosen: { 'IntDot.inherit': 'IntCell', 'IntCell.fill': 'sky-100', 'IntCell.radius': 999 }
    });
    expect([values['IntDot.fill'], values['IntDot.radius']]).toEqual(['sky-100', 999]);
    // Kept in the base, a later change to the source reaches it.
    const later = build({ base: values, chosen: { 'IntCell.fill': 'rose-100' } });
    expect(later['IntDot.fill']).toBe('rose-100');
    // Only a kind of the same role.
    expect(() => build({ chosen: { 'IntDot.inherit': 'Note' } })).toThrow(
      /IntDot\.inherit cannot be "Note"/u
    );
  });

  it('lets a kind chosen to inherit follow it where only its starter look set it apart', () => {
    // Dijkstra's weights are drawn only on links, so WeightText starts unboxed, its radius 0.
    const { design } = prepareSvelteComponent(dijkstraFields);
    expect(design.starter['WeightText.radius']).toBe(0);
    const chosen = { '$cell.radius': 4, 'WeightText.inherit': '$cell' };
    const run = (request: Parameters<typeof buildVariant>[2]) =>
      buildVariant(design.space, design.starter, request, 1, design.fallbacks, design.roles).values;
    expect(run({ chosen })['WeightText.radius']).toBe(4);
    // A value of its own, chosen before, stays.
    const base = run({ chosen: { 'WeightText.radius': 2 } });
    expect(run({ base, chosen })['WeightText.radius']).toBe(2);
  });

  it('refuses a kind inheriting what inherits it back, naming the round', () => {
    expect(() =>
      build({ chosen: { 'IntDot.inherit': 'IntCell', 'IntCell.inherit': 'IntDot' } })
    ).toThrow(/IntCell inherits IntDot inherits IntCell: a kind cannot inherit what inherits it/u);
  });

  it("refuses a style's value its heirs cannot take, naming them", () => {
    expect(() =>
      build({
        chosen: { '$cell.radius': 5, 'IntCell.inherit': '$cell', 'IntDot.inherit': '$cell' }
      })
    ).toThrow(/\$cell\.radius cannot be 5: IntCell, IntDot inherit \$cell, and its options are/u);
  });

  it('draws a style with the kinds, but never what a kind inherits', () => {
    const base = build({ chosen: { '$cell.radius': 4, 'IntCell.inherit': '$cell' } });
    const drawn = build({ base, randomise: true });
    expect(drawn['IntCell.inherit']).toBe('$cell');
    expect(drawn['IntCell.radius']).toBe(drawn['$cell.radius']);
  });

  it('takes a role’s look from its style in the base, below a kind’s own value', () => {
    const based = build({ chosen: { '<Value>.radius': 0, '<Value>.fill': '$surface' } });
    expect([based['IntCell.radius'], based['IntDot.radius']]).toEqual([0, 0]);
    expect(based['IntCell.fill']).toBe('white');
    const own = build({ chosen: { '<Value>.radius': 0, 'IntCell.radius': 12 } });
    expect([own['IntCell.radius'], own['IntDot.radius']]).toEqual([12, 0]);
  });

  it('gives each prop on a scale only its steps, refusing a value off the scale', () => {
    // The base's own values must sit on its scale too: the starter's radii 8 and 4 do not.
    const onScale = { $radius: 6, '<Code>.radius': 0 };
    expect(() => build({ chosen: { 'scale.radius': '0 6 999' } })).toThrow(
      /\$radius cannot be 8; its options are 0, 6, 999/u
    );
    const scaled = build({
      chosen: { 'scale.radius': '0 6 999', ...onScale, '<Value>.radius': 6 }
    });
    expect(scaled['IntCell.radius']).toBe(6);
    expect(() =>
      build({ chosen: { 'scale.radius': '0 6 999', ...onScale, 'IntCell.radius': 8 } })
    ).toThrow(/IntCell\.radius cannot be 8; its options are 0, 6, 999/u);
    // A line also takes 0, for no line, though its scale starts higher.
    expect(build({ chosen: { 'scale.line': '1 1.5 2', 'IntCell.strokeWidth': 0 } })).toBeDefined();
    expect(() => build({ chosen: { 'scale.spacing': '0 0.5 0.25' } })).toThrow(
      /scale\.spacing cannot be "0 0\.5 0\.25": a scale is rising numbers/u
    );
  });

  it('takes the palette’s exact colours for every colour prop', () => {
    const coloured = build({
      chosen: { 'palette.accent': '#E69F00', 'IntCell.fill': '#E69F00', $text: '#E69F00' }
    });
    expect([coloured['IntCell.fill'], coloured['Arrow.Name.color']]).toEqual([
      '#E69F00',
      '#E69F00'
    ]);
    expect(() => build({ chosen: { 'IntCell.fill': '#E69F00' } })).toThrow(/cannot be "#E69F00"/u);
    expect(() => build({ chosen: { 'palette.accent': 'orange' } })).toThrow(
      /a palette colour is exact/u
    );
    // A random variant draws an exact colour from the palette, never off it.
    const palette = { 'palette.a': '#E69F00', 'palette.b': '#56B4E9', 'palette.c': '#009E73' };
    const exact = build({ chosen: { ...palette, 'IntCell.fill': '#E69F00' } });
    for (const seed of [1, 2, 3]) {
      const drawn = buildVariant(
        levelled.space,
        levelled.starter,
        { base: exact, randomise: true },
        seed,
        levelled.fallbacks,
        levelled.roles
      ).values;
      expect(Object.values(palette)).toContain(drawn['IntCell.fill']);
    }
  });

  it('records the base’s name, and leaves out a base’s value the source has no use for', () => {
    const { values, dropped } = buildVariant(
      levelled.space,
      levelled.starter,
      { chosen: { ...starterBase, base: '$mine', '<Listing>.lit.fill': 'neutral-200' } },
      1,
      levelled.fallbacks,
      levelled.roles
    );
    expect(values.base).toBe('$mine');
    expect(values['<Listing>.lit.fill']).toBeUndefined();
    expect(dropped).toEqual([]);
    expect(() => build({ chosen: { ...starterBase, base: 'textbook' } })).toThrow(
      /names its base as "<starter>", or with \$/u
    );
  });

  it('refuses a design naming no base, or a base missing a role’s look', () => {
    const plain = (request: Parameters<typeof buildOnBase>[2]) =>
      buildOnBase(levelled.space, levelled.starter, request, 1, levelled.fallbacks, levelled.roles);
    expect(() => plain({ chosen: { 'IntCell.radius': 0 } })).toThrow(/names no base/u);
    expect(() => plain({ chosen: { base: '$textbook' } })).toThrow(
      /base sets no <Value>\.fill, .*start from a template/u
    );
    expect(plain(withStarterBase({})).values.base).toBe('<starter>');
  });
});
