/**
 * The storyboard, `<Storyboard>` holding `<Scene>`s in the order they play, each nesting the one
 * layout it shows as a tag that passes it state: only scenes read state. A scene steps through the
 * execution its `case` names, or the runs of one label it is `within`, pausing only where its `pause` says, or shows one
 * moment of them (`at`); a scene passing no state and choosing no
 * moments is a single frame, as a title card or a note. The storyboard is read from the text before
 * Svelte sees the view, and then blanked; its steps are chosen once the case is traced (sceneSteps).
 */

import {
  beforeStop,
  labelOfStep,
  type Edges,
  type MasterStep,
  type Stop
} from './algorithm/interpret.server';
import { momentTarget } from './label-values';

/** One scene as written. */
export type Scene = {
  name: string;
  /** The page layout it shows. */
  layout: string;
  /** The case it shows (see cases.server.ts); a frame shows none. */
  case?: string;
  /** The stops it pauses at, by full name: a label for its :after, label:before for its :before. */
  pause?: string[];
  /** The runs of one label it steps through, all of them or the nth to begin. */
  within?: { label: string; run?: number };
  /** One of its edges: its :before, the first of its steps, or its :after, the last. */
  at?: Stop;
  /** Shown beside its name in the controls. */
  title?: string;
  /** A query's result it steps through, one row or group a step, each as `item` (see Queries). */
  over?: { list: string; item: string };
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
const stop = /^@([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?::(before|after))?$/u;
const prop = /^\s*([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\{[^}]*\}))/u;
const tagProp = /^\s*([A-Za-z_$][\w$]*)\s*=\s*\{([^}]*)\}/u;
const sceneProps = new Set(['name', 'case', 'pause', 'within', 'at', 'title', 'over', 'as']);

/** How a storyboard is written, for messages. */
const storyboardAdvice =
  'every source ends with a <Storyboard> of the scenes it plays, in order, each nesting the layout it shows, as <Storyboard><Scene name="search" case="main"><Main values={values} lo={lo} /></Scene></Storyboard>';

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
      message: `The view has no storyboard: ${storyboardAdvice}${first ? `; a single scene is <Storyboard><Scene name="main" case="main">${tagOf(first, layouts.get(first)!)}</Scene></Storyboard>` : ''}.`,
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
        message: `<Scene${props}> shows nothing: nest the layout it shows, as <Scene name="search" case="main"><Main values={values} /></Scene>.`,
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
    if (found[1] === 'run')
      return fail(
        `A <Scene> names the execution it shows with case, as case="present", the name of a <Case>: a span is one execution of a label's code, as @insert#2.`
      );
    if (!sceneProps.has(found[1]))
      return fail(
        `A <Scene> takes name, case, pause, within, at, title, over and as: ${found[1]} is no prop of a scene.`
      );
    if (found[1] === 'over' && found[4] !== undefined) {
      given.set('over', found[4].slice(1, -1).trim());
      rest = rest.slice(found[0].length);
      continue;
    }
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
    const stops = given
      .get('pause')!
      .split(',')
      .map((each) => stop.exec(each.trim()));
    if (stops.some((each) => !each) || !stops.length)
      return fail(
        `pause="${given.get('pause')}" names the stops of spans where ${name} takes a step, separated by commas: a label by its full name for the end of each of its spans, as pause="@sort.merge.take", which @sort.merge.take:after also writes, and @sort.merge.take:before for just before each begins.`
      );
    pause = stops.map((each) => (each![2] === 'before' ? beforeStop(each![1]) : each![1]));
  }
  let within: Scene['within'];
  if (given.has('within')) {
    const run = /^@([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(?:#([1-9]\d*))?$/u.exec(
      given.get('within')!
    );
    if (!run)
      return fail(
        `within="${given.get('within')}" names the spans of a label ${name} steps through, every span, within="@sort.merge", or the nth to begin, within="@sort.merge#1"; it opens on their :before and closes on their :after.`
      );
    within = { label: run[1], ...(run[2] ? { run: Number(run[2]) } : {}) };
  }
  const written = given.get('at');
  const at = written === ':before' ? 'before' : written === ':after' ? 'after' : undefined;
  if (written !== undefined && !at)
    return fail(
      `at="${written}" is one edge of ${name}: at=":before", the first of its steps, or at=":after", its last.`
    );
  let over: Scene['over'];
  if (given.has('over') || given.has('as')) {
    const list = given.get('over') ?? '';
    const item = given.get('as') ?? '';
    if (!/^[A-Za-z_$][\w$]*$/u.test(list) || !/^[A-Za-z_$][\w$]*$/u.test(item))
      return fail(
        `A scene steps over a query's result with over and as, as <Scene name="${name}" case="main" over={levels} as="level">: one step for each row, each as level.`
      );
    const mixed = ['pause', 'within', 'at'].filter((key) => given.has(key));
    if (mixed.length)
      return fail(
        `The scene ${name} steps over ${list}, one step for each of its rows, so it takes no ${mixed.join(' or ')}: a scene steps through the case's spans or through a list, never both.`
      );
    over = { list, item };
  }
  const title = given.get('title');
  if (title !== undefined && (!title || /[():]/u.test(title)))
    return fail(
      `title="${title}" is a caption for ${name} in the controls, in words without brackets or colons.`
    );
  const tag = /^\s*<([A-Za-z_$][\w$]*)\b((?:[^>{"']|"[^"]*"|'[^']*'|\{[^}]*\})*)>\s*$/u.exec(inner);
  if (!inner.trim())
    return fail(
      `The scene ${name} shows nothing: nest the layout it shows, as <Scene name="${name}" case="main"><Main values={values} /></Scene>.`
    );
  if (!tag || !tag[2].trimEnd().endsWith('/'))
    return fail(
      `A scene nests exactly one layout, as its tag, closed at once, as <Scene name="${name}" case="main"><Main values={values} /></Scene>: what it shows is arranged in that layout.`
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
  const live =
    over && [...passed.keys()].find((input) => input !== over.list && input !== over.item);
  if (over && (live !== undefined || inputs.labels.length))
    return fail(
      `The scene ${name} steps over ${over.list}, whose steps are no moments of the case, so ${layout} reads only ${over.list} and ${over.item}: ${live ?? `@${inputs.labels[0]}`} has no value at such a step.`
    );
  const missing = inputs.variables.find((input) => !passed.has(input));
  if (missing !== undefined)
    return fail(
      `<${layout}> declares ${missing} among its inputs, and the scene ${name} passes none: pass it, as ${missing}={${missing}}.`
    );
  const reads = inputs.variables.length > 0 || inputs.labels.length > 0;
  const moments = ['case', 'pause', 'within', 'at'].filter((key) => given.has(key));
  if (!reads && moments.length)
    return fail(
      `The scene ${name} shows ${layout}, which reads no state, so it is one frame: ${moments.join(' and ')} choose${moments.length === 1 ? 's' : ''} the steps of the case a scene shows, and it shows none. Remove ${moments.length === 1 ? 'it' : 'them'}, or show a layout reading the state.`
    );
  return {
    scene: {
      name,
      layout,
      case: given.get('case'),
      pause,
      within,
      at,
      title,
      ...(over ? { over } : {}),
      frame: !reads,
      start
    },
    problems
  };
}

/** What a scene's steps are drawn from, besides the steps themselves. */
export type SceneView = {
  /** Whether the view places a listing, whose lit code is then part of each step's picture. */
  listed?: boolean;
  /** What each <When> names: a label's full name, or a stop as momentTarget gives it. */
  whens?: readonly string[];
  /** The variables the view reads, the only ones a step's picture is drawn from; else every one. */
  reads?: readonly string[];
};

/** A step a scene leaves out, drawing what the step before it, `like`, drew. */
export type LeftOutStep = { scene: Scene; step: number; like: number };

/**
 * The steps a scene shows, by their index among the run's, paced as it pauses with its edges (see
 * Edges in algorithm/interpret.server.ts): from its :before to its :after, the whole case's or those
 * of the runs of the label it is within (the nth only), with the steps it pauses at between; then
 * the first or the last where it is at one. A step the view draws from exactly what it drew the step
 * before from is left out, as it draws the same picture, and added to `leftOut`.
 */
export function sceneSteps(
  scene: Scene,
  steps: readonly MasterStep[],
  view: SceneView = {},
  leftOut?: LeftOutStep[]
): number[] {
  let chosen = steps.map((_, index) => index);
  // A scene over a list shows every row, one a step (see overSteps in compile.server.ts).
  if (scene.over) return chosen;
  if (scene.within) {
    const { label, run } = scene.within;
    const ofRun = (step: MasterStep) =>
      run === undefined
        ? labelOfStep(step.name) === label
        : step.name?.replace(/:before$/u, '') === `@${label}#${run}`;
    const first = steps.findIndex((step) => step.edge === 'before' && ofRun(step));
    const last = steps.findLastIndex((step) => step.edge === 'after' && ofRun(step));
    if (first < 0 || last < 0) return [];
    const pauses = scenePauses(scene);
    // Between the runs of every run, only what is inside one of them, and of the runs' own stops
    // only those it pauses at.
    const between = (step: MasterStep) =>
      run !== undefined ||
      (step.inside?.includes(label) &&
        !(step.edge === 'before' && !pauses.has(beforeStop(label))) &&
        !(step.edge === 'after' && labelOfStep(step.name) === label && !pauses.has(label)));
    chosen = chosen.filter(
      (index) =>
        index === first ||
        index === last ||
        (first < index && index < last && between(steps[index]))
    );
  }
  if (scene.at === 'before') return chosen.slice(0, 1);
  if (scene.at === 'after') return chosen.slice(-1);
  const absent = '\u0000absent';
  const drawnFrom = (index: number) =>
    JSON.stringify([
      view.reads
        ? view.reads.map((name) => (name in steps[index].state ? steps[index].state[name] : absent))
        : steps[index].state,
      steps[index].held,
      view.listed && steps[index].trail,
      (view.whens ?? []).map((target) => atWhen(target, steps, index))
    ]);
  const shown: number[] = [];
  for (const index of chosen) {
    const like = shown.at(-1);
    const step = steps[index];
    if (
      like !== undefined &&
      !step.labelled &&
      !step.applied &&
      drawnFrom(like) === drawnFrom(index)
    ) {
      // A scene's edge repeating the step beside it is no one's choice, so it goes unwarned.
      if (index !== chosen[0] && index !== chosen.at(-1))
        leftOut?.push({ scene, step: index, like });
    } else shown.push(index);
  }
  return shown;
}

/**
 * Whether a <When> naming `target` draws at step `at` of a case's steps: inside a run of its label,
 * or at the case's :before or :after.
 */
export function atWhen(target: string, steps: readonly MasterStep[], at: number): boolean {
  if (target === momentTarget('before')) return at === 0;
  if (target === momentTarget('after')) return at === steps.length - 1;
  return steps[at].inside?.includes(target) ?? false;
}

/** The warning for a step a scene leaves out, naming it and the step whose picture it repeats. */
export function leftOutWarning(
  { scene, step, like }: LeftOutStep,
  steps: readonly MasterStep[],
  scenes: number
): string {
  const name = (index: number) => steps[index].name ?? `step ${index + 1}`;
  return `${scenes > 1 ? `In the scene ${scene.name}, ` : ''}${name(like)} and ${name(step)} draw the same picture, so ${name(step)} is left out: pause at what changes the picture, or show what this step means with <When of="@label">.`;
}

/** The stops a scene pauses at: those its pause names, and no others. */
export const scenePauses = (scene: Scene): Set<string> => new Set(scene.pause ?? []);

/** The runs a scene is within, which open and close on a step of their own. */
export const sceneEdges = (scene: Scene): Edges | undefined => scene.within;

/**
 * How a step is labelled in a storyboard of several scenes: its scene's name, its title in
 * brackets, then the step's own name; a frame by its scene alone. A storyboard of one stepping scene
 * keeps the steps' own names.
 */
export function sceneLabel(
  scene: Pick<Scene, 'name' | 'title' | 'frame'>,
  step: string | undefined
): string {
  const head = `${scene.name}${scene.title ? ` (${scene.title})` : ''}`;
  return scene.frame || step === undefined ? head : `${head}: ${step}`;
}

/** The storyboard as built: its scenes, in the order they play, and its steps. */
export type Storyboard = {
  scenes: Scene[];
  /** Every step the storyboard can show, by label (see sceneLabel), in the order they play. */
  steps: string[];
};

/**
 * The storyboard checked against the run pausing at every label, `master`: each label a scene names
 * is one of the algorithm's, and each run it is within is one of the label's; and the steps it
 * shows, each scene's from its own steps (`paced`, pausing as it does). Scenes play in order, each
 * showing the steps it selects, whatever the one before showed.
 */
export function storyboardOf(
  scenes: readonly Scene[],
  masterOf: (scene: Scene) => readonly MasterStep[],
  labels: readonly string[],
  paced: (scene: Scene) => readonly MasterStep[],
  view: SceneView = {}
): { storyboard: Storyboard; problems: { message: string; scene: Scene }[] } {
  const problems: { message: string; scene: Scene }[] = [];
  const known = (each: string) => labels.includes(each);
  const allLabels = labels.map((each) => `@${each}`).join(', ');
  const steps = scenes.flatMap((scene) => {
    const named = [...(scene.pause ?? []), ...(scene.within ? [scene.within.label] : [])];
    for (const each of named.map((one) => one.replace(/:before$/u, '')))
      if (!known(each)) {
        problems.push({
          message: `The scene ${scene.name} names @${each}, no label of the algorithm${labels.length ? `; its labels are ${allLabels}` : ''}.`,
          scene
        });
        return [];
      }
    if (scene.frame) return [sceneLabel(scene, undefined)];
    const within = scene.within;
    const master = masterOf(scene);
    const runsWithin = (step: MasterStep) =>
      within?.run === undefined
        ? step.inside?.includes(within?.label ?? '')
        : step.runs?.includes(`${within.label}#${within.run}`);
    if (within && !master.some(runsWithin)) {
      const { label, run } = within;
      const runs = master.filter(({ name }) => name?.startsWith(`@${label}#`)).length;
      problems.push({
        message:
          run !== undefined && run > runs
            ? `within="@${label}#${run}" matches no span: in the case ${scene.case}, @${label} has ${runs} span${runs === 1 ? '' : 's'}, as @${label}#1${runs > 1 ? ` to @${label}#${runs}` : ''}.`
            : `within="@${label}" matches no span: the algorithm never runs @${label} in the case ${scene.case}.`,
        scene
      });
      return [];
    }
    const own = paced(scene);
    const chosen = sceneSteps(scene, own, view);
    const names = chosen.map((index) => own[index].name ?? '');
    return scenes.length === 1 ? names : names.map((name) => sceneLabel(scene, name));
  });
  return { storyboard: { scenes: [...scenes], steps }, problems };
}
