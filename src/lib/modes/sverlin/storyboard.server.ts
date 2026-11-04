/**
 * The storyboard, `<Storyboard>` holding `<Scene>`s in the order they play, each nesting the one
 * layout it shows as a tag that passes it state: only scenes read state. A scene steps through the
 * run, or the runs of one label it is `within`, pausing as its `pause` says or the variant's
 * `pause@` variables, or shows one moment of them (`at`); a scene passing no state and choosing no
 * moments is a single frame, as a title card or a note. The storyboard is read from the text before
 * Svelte sees the view, and then blanked; its steps are chosen once the run is traced (sceneSteps).
 */

import type { MasterStep } from './algorithm/interpret.server';

/** One scene as written. */
export type Scene = {
  name: string;
  /** The page layout it shows. */
  layout: string;
  /** The labels that end a step inside it, by full name; the variant's pause@ where none. */
  pause?: string[];
  /** The runs of one label it steps through, all of them or the nth to begin. */
  within?: { label: string; run?: number };
  /** One moment of its steps: the first or the last. */
  at?: 'start' | 'end';
  /** Shown beside its name in the controls. */
  title?: string;
  /** Passing no state and choosing no moments: one frame. */
  frame: boolean;
  start: number;
  /** Where it is written, as line and column, once the source is rewritten. */
  position?: { line: number; column: number };
};

type Problem = { message: string; start: number };
/** What a layout reads: the variables and labels it declares. */
type Inputs = { variables: readonly string[]; labels: readonly string[] };

const sceneName = /^[A-Za-z][\w-]*$/u;
const label = /^@([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/u;
const prop = /^\s*([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\{[^}]*\}))/u;
const tagProp = /^\s*([A-Za-z_$][\w$]*)\s*=\s*\{([^}]*)\}/u;
const sceneProps = new Set(['name', 'pause', 'within', 'at', 'title']);

/** How a storyboard is written, for messages. */
const storyboardAdvice =
  'every source ends with a <Storyboard> of the scenes it plays, in order, each nesting the layout it shows, as <Storyboard><Scene name="search"><Main values={values} lo={lo} /></Scene></Storyboard>';

/** The tag a scene would write for a layout, passing every input it declares. */
const tagOf = (layout: string, inputs: Inputs) =>
  `<${layout}${inputs.variables.map((input) => ` ${input}={${input}}`).join('')} />`;

/**
 * The scenes written in the source, the problems in how they are written, and where the storyboard
 * is, to blank. `scanned` is the source with comments and scripts blanked.
 */
export function writtenStoryboard(
  scanned: string,
  layouts: ReadonlyMap<string, Inputs>
): {
  scenes: Scene[];
  problems: Problem[];
  /** No storyboard written, which is reported after the view's own problems. */
  missing?: Problem;
  range?: { start: number; end: number };
} {
  const problems: Problem[] = [];
  const openings = [...scanned.matchAll(/<Storyboard\b([^>]*)>/gu)];
  if (!openings.length) {
    const first = [...layouts.keys()][0];
    const missing = {
      message: `The view has no storyboard: ${storyboardAdvice}${first ? `; a single scene is <Storyboard><Scene name="main">${tagOf(first, layouts.get(first)!)}</Scene></Storyboard>` : ''}.`,
      start: scanned.trimEnd().length
    };
    return { scenes: [], problems, missing };
  }
  for (const extra of openings.slice(1))
    problems.push({
      message:
        'A source has one <Storyboard>: put every scene in the first, in the order they play.',
      start: extra.index ?? 0
    });
  const [opening] = openings;
  const start = opening.index ?? 0;
  if (opening[1].trim())
    problems.push({
      message: `<Storyboard> takes no props: ${storyboardAdvice}.`,
      start
    });
  const bodyStart = start + opening[0].length;
  const closing = /<\/Storyboard\s*>/u.exec(scanned.slice(bodyStart));
  if (!closing) {
    problems.push({
      message:
        'The <Storyboard> is never closed: close it with </Storyboard> after its last scene.',
      start
    });
    return { scenes: [], problems };
  }
  const bodyEnd = bodyStart + closing.index;
  const end = bodyEnd + closing[0].length;
  const body = scanned.slice(bodyStart, bodyEnd);
  const scenes: Scene[] = [];
  const written = /<Scene\b((?:[^>{"']|"[^"]*"|'[^']*'|\{[^}]*\})*)>|<\/Scene\s*>/gu;
  let rest = 0;
  let open: { props: string; start: number; inner: number } | undefined;
  for (const match of body.matchAll(written)) {
    const at = match.index ?? 0;
    if (match[0].startsWith('</')) {
      if (!open) {
        problems.push({ message: 'This </Scene> closes no scene.', start: bodyStart + at });
        continue;
      }
      const scene = sceneOf(
        open.props,
        body.slice(open.inner, at),
        bodyStart + open.start,
        layouts
      );
      problems.push(...scene.problems);
      if (scene.scene) scenes.push(scene.scene);
      open = undefined;
      rest = at + match[0].length;
      continue;
    }
    if (open) {
      problems.push({
        message: 'A scene is never closed: close each with </Scene> before the next.',
        start: bodyStart + open.start
      });
      open = undefined;
    }
    if (body.slice(rest, at).trim())
      problems.push({
        message: `A <Storyboard> holds only <Scene>s: ${storyboardAdvice}.`,
        start: bodyStart + rest
      });
    const props = match[1];
    if (props.trimEnd().endsWith('/')) {
      problems.push({
        message: `<Scene${props}> shows nothing: nest the layout it shows, as <Scene name="search"><Main values={values} /></Scene>.`,
        start: bodyStart + at
      });
      rest = at + match[0].length;
      continue;
    }
    open = { props, start: at, inner: at + match[0].length };
  }
  if (open)
    problems.push({
      message: 'A scene is never closed: close it with </Scene>.',
      start: bodyStart + open.start
    });
  else if (body.slice(rest).trim())
    problems.push({
      message: `A <Storyboard> holds only <Scene>s: ${storyboardAdvice}.`,
      start: bodyStart + rest
    });
  if (!scenes.length && !problems.length)
    problems.push({ message: `The <Storyboard> has no scenes: ${storyboardAdvice}.`, start });
  const named = new Set<string>();
  for (const scene of scenes) {
    if (named.has(scene.name))
      problems.push({
        message: `Two scenes are named ${scene.name}: a scene's name is its title in the controls, so give each its own.`,
        start: scene.start
      });
    named.add(scene.name);
  }
  return { scenes, problems, range: { start, end } };
}

/** One scene from its props and what it holds. */
function sceneOf(
  props: string,
  inner: string,
  start: number,
  layouts: ReadonlyMap<string, Inputs>
): { scene?: Scene; problems: Problem[] } {
  const problems: Problem[] = [];
  const fail = (message: string) => ({ problems: [...problems, { message, start }] });
  const given = new Map<string, string>();
  let rest = props;
  while (rest.trim()) {
    const found = prop.exec(rest);
    if (!found)
      return fail(
        `<Scene${props}> is no scene: a scene is written <Scene name="search">…</Scene>, its props written as they are.`
      );
    if (!sceneProps.has(found[1]))
      return fail(
        `A <Scene> takes name, pause, within, at, and title: ${found[1]} is no prop of a scene.`
      );
    if (found[4] !== undefined)
      return fail(
        `A <Scene>'s ${found[1]} is written as it is, not computed, as pause="@sort.merge.take": every scene's steps are known before the algorithm runs.`
      );
    given.set(found[1], (found[2] ?? found[3]).trim());
    rest = rest.slice(found[0].length);
  }
  const name = given.get('name');
  if (!name || !sceneName.test(name))
    return fail(
      `A scene is named, in one word that may hold digits and dashes, as <Scene name="one-merge">: its name is its title in the controls.`
    );
  let pause: string[] | undefined;
  if (given.has('pause')) {
    const labels = given
      .get('pause')!
      .split(',')
      .map((each) => each.trim());
    const wrong = labels.find((each) => !label.test(each));
    if (wrong !== undefined || !labels.length)
      return fail(
        `pause="${given.get('pause')}" names the labels that end a step in ${name}, by full name, separated by commas, as pause="@sort.merge.take, @sort.merge.rest".`
      );
    pause = labels.map((each) => each.slice(1));
  }
  let within: Scene['within'];
  if (given.has('within')) {
    const run = /^@([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?:#([1-9]\d*))?$/u.exec(
      given.get('within')!
    );
    if (!run)
      return fail(
        `within="${given.get('within')}" names the runs of a label ${name} steps through, every run, within="@sort.merge", or the nth to begin, within="@sort.merge#1".`
      );
    within = { label: run[1], ...(run[2] ? { run: Number(run[2]) } : {}) };
  }
  const at = given.get('at');
  if (at !== undefined && at !== 'start' && at !== 'end')
    return fail(
      `at="${at}" is one moment of ${name}'s steps: at="start", its first, or at="end", its last.`
    );
  const title = given.get('title');
  if (title !== undefined && (!title || /[():]/u.test(title)))
    return fail(
      `title="${title}" is a caption for ${name} in the controls, in words without brackets or colons.`
    );
  const tag = /^\s*<([A-Za-z_$][\w$]*)\b((?:[^>{"']|"[^"]*"|'[^']*'|\{[^}]*\})*)>\s*$/u.exec(inner);
  if (!inner.trim())
    return fail(
      `The scene ${name} shows nothing: nest the layout it shows, as <Scene name="${name}"><Main values={values} /></Scene>.`
    );
  if (!tag || !tag[2].trimEnd().endsWith('/'))
    return fail(
      `A scene nests exactly one layout, as its tag, closed at once, as <Scene name="${name}"><Main values={values} /></Scene>: what it shows is arranged in that layout.`
    );
  const [, layout, tagProps] = tag;
  const inputs = layouts.get(layout);
  if (!inputs)
    return fail(
      `The scene ${name} shows <${layout} />, and no layout is named ${layout}: declare it, <Layout name="${layout}" of="…">…</Layout>, or show one that exists${layouts.size ? `, as ${[...layouts.keys()].join(', ')}` : ''}.`
    );
  const passed = new Map<string, string>();
  let remaining = tagProps.trimEnd().slice(0, -1);
  while (remaining.trim()) {
    const found = tagProp.exec(remaining);
    if (!found)
      return fail(
        `The scene ${name} passes ${layout} its inputs as name={value}, as ${tagOf(layout, inputs)}.`
      );
    passed.set(found[1], found[2].trim());
    remaining = remaining.slice(found[0].length);
  }
  for (const [input, value] of passed) {
    if (!inputs.variables.includes(input))
      return fail(
        inputs.variables.length || inputs.labels.length
          ? `${layout} has no input ${input}: it declares of="${[...inputs.variables, ...inputs.labels.map((each) => `@${each}`)].join(', ')}".`
          : `The scene ${name} passes ${input} to ${layout}, which reads no state: a layout reading none is one frame, as a title card; declare ${input} in its of to show it.`
      );
    if (value !== input)
      return fail(
        `${input}={${value}} passes ${input} another value: a scene passes the state of the input's own name, as ${input}={${input}}.`
      );
  }
  const missing = inputs.variables.find((input) => !passed.has(input));
  if (missing !== undefined)
    return fail(
      `<${layout}> declares ${missing} among its inputs, and the scene ${name} passes none: pass it, as ${missing}={${missing}}.`
    );
  const reads = inputs.variables.length > 0 || inputs.labels.length > 0;
  const moments = ['pause', 'within', 'at'].filter((key) => given.has(key));
  if (!reads && moments.length)
    return fail(
      `The scene ${name} shows ${layout}, which reads no state, so it is one frame: ${moments.join(' and ')} choose${moments.length === 1 ? 's' : ''} the steps of the run a scene shows, and it shows none. Remove ${moments.length === 1 ? 'it' : 'them'}, or show a layout reading the state.`
    );
  return {
    scene: { name, layout, pause, within, at, title, frame: !reads, start },
    problems
  };
}

/**
 * The steps a scene shows, by their index among the run's: every step, or those inside the runs of
 * the label it is within (the nth only, from the step after the one ending the run before it to the
 * step ending it), then the first or the last where it is at one. The run must pause at that label,
 * so the step ending each of its runs is named for it (see scenePauses).
 */
export function sceneSteps(scene: Scene, steps: readonly MasterStep[]): number[] {
  let chosen = steps.map((_, index) => index);
  if (scene.within) {
    const { label: within, run } = scene.within;
    chosen = chosen.filter((index) => steps[index].inside?.includes(within));
    if (run !== undefined) {
      const ends = steps.flatMap(({ name }, index) =>
        name?.startsWith(`@${within}#`) ? [index] : []
      );
      const end = steps.findIndex(({ name }) => name === `@${within}#${run}`);
      if (end < 0) return [];
      const after = ends.filter((index) => index < end).at(-1) ?? -1;
      chosen = chosen.filter((index) => index > after && index <= end);
    }
  }
  if (scene.at === 'start') return chosen.slice(0, 1);
  if (scene.at === 'end') return chosen.slice(-1);
  return chosen;
}

/** How a scene pauses: as its pause says, else as the variant does, and always at its within. */
export function scenePauses<Mode extends string>(
  scene: Scene,
  variant: ReadonlyMap<string, Mode>,
  pausing: (labels: readonly string[]) => Map<string, Mode>
): Map<string, Mode> {
  const pauses = scene.pause ? pausing(scene.pause) : new Map(variant);
  const within = scene.within?.label;
  if (within && !pauses.has(within))
    for (const [key, mode] of pausing([within])) pauses.set(key, mode);
  return pauses;
}

/**
 * How a step is labelled in a storyboard of several scenes: its scene's name, ↺ where the scene goes
 * back in the run, its title in brackets, then the step's own name; a frame by its scene alone. A
 * storyboard of one stepping scene keeps the steps' own names.
 */
export function sceneLabel(
  scene: Pick<Scene, 'name' | 'title' | 'frame'>,
  rewind: boolean,
  step: string | undefined
): string {
  const head = `${scene.name}${rewind ? ' ↺' : ''}${scene.title ? ` (${scene.title})` : ''}`;
  return scene.frame || step === undefined ? head : `${head}: ${step}`;
}

/** The storyboard as built: its scenes, each marked where it goes back in the run, and its steps. */
export type Storyboard = {
  scenes: (Scene & { rewind: boolean })[];
  /** Every step the storyboard can show, by label (see sceneLabel), in the order they play. */
  steps: string[];
};

/**
 * The storyboard checked against the run pausing at every label, `master`: each label a scene names
 * is one of the algorithm's, each run it is within is one of the label's, and each scene shows a
 * step. A stepping scene going back in the run, to before where the stepping scene before it ended,
 * is a rewind.
 */
export function storyboardOf(
  scenes: readonly Scene[],
  master: readonly MasterStep[],
  labels: readonly string[]
): { storyboard: Storyboard; problems: { message: string; scene: Scene }[] } {
  const problems: { message: string; scene: Scene }[] = [];
  const known = (each: string) => labels.includes(each);
  const listed = labels.map((each) => `@${each}`).join(', ');
  const chosen = scenes.map((scene) => {
    for (const each of [...(scene.pause ?? []), ...(scene.within ? [scene.within.label] : [])])
      if (!known(each)) {
        problems.push({
          message: `The scene ${scene.name} names @${each}, no label of the algorithm${labels.length ? `; its labels are ${listed}` : ''}.`,
          scene
        });
        return [];
      }
    if (scene.frame) return [];
    const steps = sceneSteps(scene, master);
    if (!steps.length && scene.within) {
      const { label, run } = scene.within;
      const runs = master.filter(({ name }) => name?.startsWith(`@${label}#`)).length;
      problems.push({
        message:
          run !== undefined && run > runs
            ? `within="@${label}#${run}" matches no run: @${label} runs ${runs} time${runs === 1 ? '' : 's'}, as @${label}#1${runs > 1 ? ` to @${label}#${runs}` : ''}.`
            : `within="@${label}" matches no run: the algorithm never runs @${label} with this input.`,
        scene
      });
    }
    return steps;
  });
  let end = -1;
  const marked = scenes.map((scene, index) => {
    const steps = chosen[index];
    if (scene.frame || !steps.length) return { ...scene, rewind: false };
    const rewind = end >= 0 && steps[0] < end;
    end = steps.at(-1)!;
    return { ...scene, rewind };
  });
  const own = (index: number) => master[index].name ?? `Step ${index + 1}`;
  const single = marked.length === 1 && !marked[0].frame;
  const steps = marked.flatMap((scene, index) => {
    if (scene.frame) return [sceneLabel(scene, false, undefined)];
    const names = chosen[index].map(own);
    // A variant pausing at fewer labels ends the run on a step of its own, the end.
    if (chosen[index].at(-1) === master.length - 1 && names.at(-1) !== 'end') names.push('end');
    return single ? names : names.map((name) => sceneLabel(scene, scene.rewind, name));
  });
  return { storyboard: { scenes: marked, steps }, problems };
}
