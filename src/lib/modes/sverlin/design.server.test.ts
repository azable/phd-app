import { describe, expect, it } from 'vitest';

import { bundlePresentation as bundleOnBase, prepareSvelteComponent } from './compile.server';
import { linearSearchSource } from './contract';
import bst from './fixtures/bst.sverlin?raw';
import pseudocode from './fixtures/listing-pseudocode.sverlin?raw';
import bfs from './fixtures/bfs-visit-order.sverlin?raw';
import undirected from './fixtures/bfs-undirected.sverlin?raw';
import { forms } from './library/node/forms';
import {
  buildVariant as buildOnBase,
  DesignValueError,
  type VariantRequest
} from './design.server';
import { templateValues } from './templates/templates';

const starterBase = templateValues('starter');
import { onStarter } from './testing/scenes';

// The bases of every source's kinds this file builds, which no two sources name alike.
const allBases: Record<string, string> = {};
// Each request on `$starter` where it names no template (see onStarter), and every kind on its base.
const buildVariant = (
  offered: Parameters<typeof buildOnBase>[0],
  start: Parameters<typeof buildOnBase>[1],
  request: VariantRequest,
  seed: number,
  fallbacks: Parameters<typeof buildOnBase>[4] = {},
  bases: Parameters<typeof buildOnBase>[5] = allBases
) => buildOnBase(offered, start, onStarter(request), seed, fallbacks, bases);
const bundlePresentation = (
  component: Parameters<typeof bundleOnBase>[0],
  seed: number,
  request: VariantRequest = {},
  options?: Parameters<typeof bundleOnBase>[3]
) => bundleOnBase(component, seed, onStarter(request), options);

const prepared = prepareSvelteComponent(linearSearchSource);
Object.assign(allBases, prepared.design.bases);
const { space, starter } = prepared.design;
// Every variable's value on a copy of `$starter`, as a first version naming it draws.
const plain = () => buildVariant(space, starter, {}, 1).values;

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

  it('starts each type in its first view, and of a kind only the looks its nodes give it', () => {
    // A kind's props, a token and a role's style, as <Value>.fill, come from the design file.
    expect(
      Object.keys(starter).filter((key) => key.startsWith('$') || key.startsWith('<'))
    ).toEqual([]);
    expect(starter['IntCell.fill']).toBeUndefined();
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
    // A value the file no longer holds follows the kind's base, <Node>, which writes no fill.
    expect(values['IntCell.fill']).toBe('none');
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
    );
    expect(apart.values['Highlight.<Link>.<To>:found.fill']).toBe(second);
    expect(apart.values['Highlight.<Link>.<To>:i.fill']).toBe(
      apart.values['Highlight.<Link>.<To>.fill']
    );
    const kept = buildVariant(
      space,
      starter,
      { base: apart.design, chosen: { 'Highlight.<Link>.<To>.fill': first } },
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
    const first = plain();
    for (const values of variants) {
      // Every kind that shared the starter's text colour still shares one.
      const colours = Object.entries(values)
        .filter(([key]) => key.endsWith('.color') && first[key] === first['IntCell.color'])
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

  it('gives every kind of node the style props, drawn at random where the file writes them but for decoration', () => {
    expect(space['IntCell.shadow']).toEqual(['none', 'soft', 'lifted', 'hard']);
    expect(space['Highlight.Name.case']).toEqual(['normal', 'uppercase', 'small-caps']);
    expect(plain()['Row.fillStyle']).toBe('solid');
    expect(() => buildVariant(space, starter, { chosen: { 'IntCell.glow': 'bright' } }, 1)).toThrow(
      'IntCell.glow cannot be "bright"'
    );
    const variants = Array.from(
      { length: 8 },
      (_, seed) =>
        buildVariant(
          space,
          starter,
          { base: { '<Node>.shadow': 'soft', '<Node>.decoration': 'underline' }, randomise: true },
          seed + 1
        ).values
    );
    for (const values of variants) expect(values['Title.decoration']).toBe('underline');
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
  Object.assign(allBases, tree.bases, graph.bases);

  it('give the kind arranging one its form, direction, curve, and layout seed', () => {
    // A tree takes every form but layered, which only layers take (layered-engine.ts).
    expect(tree.space['Tree.form']).toEqual(forms.filter((form) => form !== 'layered'));
    expect(graph.space['Graph.form']).toEqual(forms);
    expect(tree.space['Tree.curve']).toEqual(['straight', 'curved']);
    expect(tree.space['Tree.layoutSeed']).toContain(1);
    expect(buildVariant(tree.space, tree.starter, {}, 1).values).toMatchObject({
      'Tree.form': 'natural',
      'Tree.curve': 'straight',
      'Tree.layoutSeed': 1
    });
    // Every structure runs right unless a variant says, a tree too.
    expect(tree.space['Tree.direction']).toEqual(['down', 'right']);
    expect(graph.space['Graph.direction']).toEqual(['down', 'right']);
    expect(buildVariant(graph.space, graph.starter, {}, 1).values['Graph.direction']).toBe('right');
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
    expect(buildVariant(graph.space, graph.starter, {}, 1).values).toMatchObject({
      'Graph.<Link>.route': 'layout',
      'Graph.<Link>.<To>.head': 'arrow',
      'Graph.<Link>.headSize': 9
    });
    const base = {
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
    // Elsewhere the kind has no head of its own: its base's, an arrow.
    expect(prepareSvelteComponent(bfs).design.starter['Graph.<Link>.<To>.head']).toBeUndefined();
    expect(buildVariant(graph.space, graph.starter, {}, 1).values['Graph.<Link>.<To>.head']).toBe(
      'arrow'
    );
  });
});

describe('design tokens, bases and styles', () => {
  // IntCell, IntDot, Cells and Note are kinds of <Node>, Cells arranging others; Arrow.<Link> is a
  // link, made by <Link>, and Arrow.<Link>.<To> its end; `{v}` is a place, IntCell:v.
  const levelled = prepareSvelteComponent(
    `<script domain>const Int = type([1, 3]); const Values = array(Int, { max: 8 }); const Position = index(Values);</script><script input>const values = Values;</script><Case name="main" values={[1, 3]} /><script algorithm>@run[let i = Position(0); let j = Position(1);]</script><View of="Int" name="IntCell"><Node value={this} /></View>\n<View of="Int" name="IntDot"><Node value={this} /></View>\n<View of="Position" name="Arrow"><Node layout="column"><Link to={this} /><Node kind="Name">i</Node></Node></View>\n<Layout name="Cells"><Node layout="row">{#each values as v}{v}{/each}</Node></Layout><Layout name="Note"><Node>note</Node></Layout><Layout name="Main"><Node><Cells />{i}<Note /></Node></Layout><Storyboard><Scene name="main" case="main"><Main /></Scene></Storyboard>`
  ).design;
  const built = (request: Parameters<typeof buildVariant>[2]) =>
    buildVariant(levelled.space, levelled.starter, request, 1, levelled.fallbacks, levelled.bases);
  const build = (request: Parameters<typeof buildVariant>[2]) => built(request).values;
  // The value kinds linked to the template's value frame, as a design links each kind to a style.
  const cells = { 'IntCell.inherit': '$cell', 'IntDot.inherit': '$cell' };

  it('starts every kind at its base, which names the tokens it shares', () => {
    expect(build({})['$spacing']).toBe(0.375);
    expect(levelled.space['<Node>.padding']).toContain('$spacing');
    expect(levelled.space['<Node>.shown']).toBeUndefined();
    expect(levelled.space['<Link>.<To>.fill']).toBeDefined();
    expect(levelled.space['<Node>.<To>.fill']).toBeUndefined();
    expect(levelled.bases).toMatchObject({
      IntCell: '<Node>',
      Cells: '<Node>',
      'Arrow.<Link>': '<Link>',
      'Arrow.<Link>.<To>': '<Link>.<To>'
    });
    // A kind's props come from what its nodes do: a node arranging others has a layout's.
    expect(levelled.space['Cells.gap']).toBeDefined();
    expect(levelled.space['IntCell.gap']).toBeUndefined();
    const values = build({});
    for (const [key, value] of Object.entries(levelled.starter)) expect(values[key]).toBe(value);
    // Not linked, a value's kind takes <Node>'s plain look.
    expect([values['IntCell.fill'], values['IntCell.padding']]).toEqual(['none', 0]);
  });

  it('changes every kind following a token, and a base or style sets every kind following it', () => {
    const spacing = build({ chosen: { ...cells, $spacing: 0.25 } });
    expect([spacing['IntCell.padding'], spacing['IntDot.padding']]).toEqual([0.25, 0.25]);
    expect(spacing['Cells.padding']).toBe(0);
    const styled = build({ chosen: { ...cells, $spacing: 0.25, '$cell.padding': 0.5 } });
    expect([styled['IntCell.padding'], styled['IntDot.padding'], styled['Note.padding']]).toEqual([
      0.5, 0.5, 0
    ]);
    const named = build({ chosen: { ...cells, '<Node>.fill': '$highlight' } });
    expect([named['IntCell.fill'], named['Note.fill']]).toEqual(['white', 'amber-100']);
  });

  it('refuses the names of the roles’ styles and other old spellings, giving the new', () => {
    expect(() => build({ chosen: { '$Value.fill': 'white' } })).toThrow(
      /\$Value is gone: write a template's style a kind links to, as "IntCell": \{"\.\.\.": "\$cell"\}/u
    );
    for (const role of ['<Value>', '<Container>', '<Text>', '<Icon>'])
      expect(() => build({ chosen: { [`${role}.padding`]: 0.5 } })).toThrow(
        new RegExp(`${role} is gone: write a template's style a kind links to`, 'u')
      );
    expect(() => build({ chosen: { '<Pointer>.stroke': 'red-500' } })).toThrow(
      /<Pointer> is gone: write <Link>/u
    );
    expect(() => build({ chosen: { 'IntCell.inherit': '<Value>' } })).toThrow(/<Value> is gone/u);
    expect(() => build({ chosen: { 'listing.syntax': 'colour' } })).toThrow(
      /listing is gone: write <Listing>/u
    );
    expect(() => build({ chosen: { base: '$starter' } })).toThrow(
      /"\.\.\." at the top named a base the design followed, which is gone/u
    );
    expect(() => build({ chosen: { 'Arrow.Link.stroke': 'red-500' } })).toThrow(
      /Arrow\.Link\.stroke is written Arrow\.<Link>\.stroke/u
    );
    expect(() => build({ chosen: { 'Arrow.<Link>:i.targetFill': 'sky-100' } })).toThrow(
      /Arrow\.<Link>:i\.targetFill is written Arrow\.<Link>\.<To>:i\.fill/u
    );
  });

  it("keeps a kind's own value and a place's over its base", () => {
    const own = build({ chosen: { '<Node>.padding': 0.5, 'IntCell.padding': 0.125 } });
    expect([own['IntCell.padding'], own['IntDot.padding']]).toEqual([0.125, 0.5]);
    const placed = build({ chosen: { '<Node>.fill': 'sky-100', 'IntCell:v.fill': 'rose-100' } });
    expect([placed['IntCell.fill'], placed['IntCell:v.fill']]).toEqual(['sky-100', 'rose-100']);
    // A place not set apart follows its kind, and so the base.
    expect(build({ chosen: { '<Node>.fill': 'sky-100' } })['IntCell:v.fill']).toBe('sky-100');
    // A value the design file writes stays when a token changes later.
    const base = built({ chosen: { ...cells, 'IntCell.padding': 0.125 } }).design;
    expect(build({ base, chosen: { $spacing: 0.5 } })['IntCell.padding']).toBe(0.125);
    expect(build({ base, chosen: { $spacing: 0.5 } })['IntDot.padding']).toBe(0.5);
  });

  it('refuses a token or a base’s value outside its options, naming them', () => {
    expect(() => build({ chosen: { $radius: 5 } })).toThrow(
      /\$radius cannot be 5; its options are 0, 2, 4, 6, 8, 12, 999/u
    );
    expect(() => build({ chosen: { '<Node>.padding': '$radius' } })).toThrow(
      /<Node>\.padding cannot be "\$radius"/u
    );
  });

  it('draws tokens with the kinds holding their value, so kinds following one stay alike', () => {
    const drawn = build({ chosen: cells, randomise: true });
    expect(drawn['IntCell.padding']).toBe(drawn['$spacing']);
    expect(drawn['IntCell.color']).toBe(drawn['$text']);
  });

  it('draws over the template a first version copies', () => {
    const drawn = [1, 2, 3, 4].map((seed) =>
      buildOnBase(
        levelled.space,
        levelled.starter,
        { chosen: { template: '$starter', ...cells }, randomise: true },
        seed,
        levelled.fallbacks,
        levelled.bases
      )
    );
    expect(new Set(drawn.map(({ values }) => values['$spacing'])).size).toBeGreaterThan(1);
    for (const { values, origins, design } of drawn) {
      expect(design).not.toHaveProperty('template');
      expect(design['$spacing']).toBe(values['$spacing']);
      expect(values['IntCell.padding']).toBe(values['$spacing']);
      expect(origins['$spacing']).toBe(
        values['$spacing'] === starterBase.$spacing ? 'starter' : 'random'
      );
    }
  });

  it('takes the listing settings under <Listing>', () => {
    const { design } = prepareSvelteComponent(pseudocode);
    const chosen = { '<Listing>.syntax': 'colour' };
    const values = buildVariant(design.space, design.starter, { chosen }, 1).values;
    expect(values['<Listing>.syntax']).toBe('colour');
  });

  it('gives a kind what it inherits from a style, over its base and token, under its own', () => {
    const styled = build({
      chosen: {
        $spacing: 0.25,
        '<Node>.padding': 0.5,
        '$cell.padding': 0.125,
        '$cell.radius': 2,
        ...cells,
        'IntDot.radius': 999
      }
    });
    expect([styled['IntCell.padding'], styled['IntDot.padding']]).toEqual([0.125, 0.125]);
    // Its own value wins; a prop the style does not set comes from its base.
    expect([styled['IntCell.radius'], styled['IntDot.radius']]).toEqual([2, 999]);
    expect(styled['Note.padding']).toBe(0.5);
    // A style's value can name a token, which it then follows.
    const tokened = build({
      chosen: { '$cell.fill': '$highlight', 'IntCell.inherit': '$cell' }
    });
    expect(tokened['IntCell.fill']).toBe('amber-100');
    expect(levelled.starter['IntCell.inherit']).toBeUndefined();
  });

  it('gives a kind what it inherits from any other kind, after that kind settles', () => {
    const values = build({
      chosen: { 'IntDot.inherit': 'IntCell', 'IntCell.fill': 'sky-100', 'IntCell.radius': 999 }
    });
    expect([values['IntDot.fill'], values['IntDot.radius']]).toEqual(['sky-100', 999]);
    // Kept in the design file, a later change to the source reaches it.
    const file = built({
      chosen: { 'IntDot.inherit': 'IntCell', 'IntCell.fill': 'sky-100', 'IntCell.radius': 999 }
    }).design;
    const later = build({ base: file, chosen: { 'IntCell.fill': 'rose-100' } });
    expect(later['IntDot.fill']).toBe('rose-100');
    // Any kind of the source, a text's or a layout's too, but no kind it has not.
    expect(build({ chosen: { 'IntDot.inherit': 'Note' } })['IntDot.inherit']).toBe('Note');
    expect(() => build({ chosen: { 'IntDot.inherit': 'Nothing' } })).toThrow(
      /IntDot\.inherit cannot be "Nothing"/u
    );
  });

  it('lets a kind chosen to inherit follow it over the starting look its nodes give it', () => {
    // A collection's items sit at its start or centre by whether its length changes: its own start.
    const [key, look] = Object.entries(starter).find(([variable]) =>
      /\.(justify|xAnchor|yAnchor)$/u.test(variable)
    )!;
    const kind = key.slice(0, key.lastIndexOf('.'));
    const prop = key.slice(kind.length + 1);
    const other = space[key].find((option) => option !== look)!;
    const run = (request: Parameters<typeof buildVariant>[2]) =>
      buildVariant(space, starter, request, 1, prepared.design.fallbacks, prepared.design.bases)
        .values;
    expect(run({})[key]).toBe(look);
    expect(run({ chosen: { [`$along.${prop}`]: other, [`${kind}.inherit`]: '$along' } })[key]).toBe(
      other
    );
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
    const base = built({ chosen: { '$cell.radius': 4, 'IntCell.inherit': '$cell' } }).design;
    const drawn = build({ base, randomise: true });
    expect(drawn['IntCell.inherit']).toBe('$cell');
    expect(drawn['IntCell.radius']).toBe(drawn['$cell.radius']);
  });

  it('takes a kind’s look from its base, below a kind’s own value', () => {
    const based = build({ chosen: { '<Node>.radius': 4, '<Node>.fill': '$surface' } });
    expect([based['IntCell.radius'], based['Note.radius']]).toEqual([4, 4]);
    expect(based['IntCell.fill']).toBe('white');
    const own = build({ chosen: { '<Node>.radius': 4, 'IntCell.radius': 12 } });
    expect([own['IntCell.radius'], own['IntDot.radius']]).toEqual([12, 4]);
    // A link's line follows <Link>, and the paint its end gives what it reaches <Link>.<To>.
    const linked = build({ chosen: { '<Link>.stroke': 'red-500', '<Link>.<To>.fill': 'sky-100' } });
    expect([linked['Arrow.<Link>.stroke'], linked['Arrow.<Link>.<To>.fill']]).toEqual([
      'red-500',
      'sky-100'
    ]);
  });

  it('gives each prop on a scale only its steps, refusing a value off the scale', () => {
    // The template's own values must sit on its scale too: the starter's radii 8 and 4 do not.
    const onScale = { $radius: 6, '<Code>.radius': 0 };
    expect(() => build({ chosen: { 'scale.radius': '0 6 999' } })).toThrow(
      /\$radius cannot be 8; its options are 0, 6, 999/u
    );
    const scaled = build({
      chosen: { 'scale.radius': '0 6 999', ...onScale, ...cells, '$cell.radius': 6 }
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
    const exact = built({ chosen: { ...palette, 'IntCell.fill': '#E69F00' } }).design;
    for (const seed of [1, 2, 3]) {
      const drawn = buildVariant(
        levelled.space,
        levelled.starter,
        { base: exact, randomise: true },
        seed,
        levelled.fallbacks,
        levelled.bases
      ).values;
      expect(Object.values(palette)).toContain(drawn['IntCell.fill']);
    }
  });

  it('keeps in the file a template’s value the source has no use for, and draws without it', () => {
    const { values, design, dropped } = built({
      chosen: { template: '$starter', '<Listing>.lit.fill': 'neutral-200' }
    });
    expect(design['<Listing>.lit.fill']).toBe('neutral-200');
    expect(values['<Listing>.lit.fill']).toBeUndefined();
    expect(dropped).toEqual([]);
    expect(Object.keys(design).length).toBe(Object.keys(starterBase).length);
    expect(() => build({ chosen: { template: 'textbook' } })).toThrow(
      /"template" names "textbook", which is no template; the templates are \$starter, \$textbook/u
    );
  });

  it('refuses a first version naming no template, and copies the one named', () => {
    const first = (request: Parameters<typeof buildOnBase>[2]) =>
      buildOnBase(levelled.space, levelled.starter, request, 1, levelled.fallbacks, levelled.bases);
    expect(() => first({ chosen: { 'IntCell.radius': 0 } })).toThrow(
      /names no template: a first version copies one, as \{"template": "\$starter"\}/u
    );
    const copied = first({ chosen: { template: '$slide', 'IntCell.radius': 0 } });
    expect(copied.design['IntCell.radius']).toBe(0);
    expect(copied.design['$text']).toBe(templateValues('slide')['$text']);
    // Naming a template later copies its file in place of the one built on.
    const again = first({ base: copied.design, chosen: { template: '$textbook' } });
    expect(again.design['IntCell.radius']).toBeUndefined();
    expect(again.design['$font']).toBe('serif');
  });
});
