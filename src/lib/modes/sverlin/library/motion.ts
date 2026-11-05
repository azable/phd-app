/**
 * Moving from one step to the next. Each step is drawn in a layer of its own, laid out before it
 * shows, so a node drawing the same value, or the same pointer, in both layers (data-sv-identity)
 * starts where it was and moves to its new place: it is drawn in place and translated back, then
 * the translation runs out. It starts the size and paint it had too, and changes to its new ones
 * over the same time, so a box growing about its anchor grows while its neighbours make way, and a
 * highlight passing from one value to the next fades across. A copy of a value starts where its
 * source was; a new value fades in, unless it is part of one that moves; a value gone fades out
 * with the layer it was in, kept over the new one until then. A value, or a copy, drawn in more
 * places than its source was pairs each old place with the new one drawn in the most similar place,
 * by the kinds around it; the others fade in where they are, as a start vertex's name appearing in
 * a caption, which would otherwise fly in from the title with its sentence.
 */

/**
 * How long a move takes, in milliseconds: long enough to follow two values swapping, short enough
 * that stepping through at a reading pace never waits for it. The next step finishes it at once.
 */
export const motionDuration = 400;
const easing = 'ease-in-out';
/** Moves smaller than this, in pixels, are rounding, not movement. */
const still = 0.5;

/** CSS for a layer whose gone values fade out over the next one (see leaveLayer). */
export const motionCss = `.sv-layer.sv-leaving { visibility: hidden; pointer-events: none; z-index: 1; }
.sv-layer.sv-leaving [data-sv-gone] { visibility: visible; }
.sv-layer.sv-leaving [data-sv-gone] [data-sv-hidden='false'] { visibility: visible; }
.sv-layer.sv-leaving [data-sv-gone] [data-sv-hidden='true'] { visibility: hidden; }`;

type Placed = { element: HTMLElement; box: DOMRect };

/**
 * The visible nodes of a layer by identity, outermost only, as a component's root and the node
 * inside it can draw one value: in document order, more than one where a value is drawn twice.
 */
function placedByIdentity(layer: HTMLElement): Map<string, Placed[]> {
  const found = new Map<string, Placed[]>();
  for (const element of layer.querySelectorAll<HTMLElement>('[data-sv-identity]')) {
    if (element.closest<HTMLElement>('[data-sv-hidden]')?.dataset.svHidden === 'true') continue;
    const identity = element.dataset.svIdentity ?? '';
    if (element.parentElement?.closest(`[data-sv-identity="${CSS.escape(identity)}"]`)) continue;
    found.set(identity, [
      ...(found.get(identity) ?? []),
      { element, box: element.getBoundingClientRect() }
    ]);
  }
  return found;
}

/**
 * The nodes of a layer that draw no value of their own but frame exactly one, as a cell of a kind an
 * {#if} chose around the value it holds, each with its box and the identity of the value it holds.
 */
function framesOf(layer: HTMLElement): (Placed & { holds: string; value: HTMLElement })[] {
  return [...layer.querySelectorAll<HTMLElement>('.sv-node:not([data-sv-identity])')].flatMap(
    (element) => {
      if (element.closest<HTMLElement>('[data-sv-hidden]')?.dataset.svHidden === 'true') return [];
      // The values it holds, outermost only, as a component's root and a node inside draw one.
      const values = [...element.querySelectorAll<HTMLElement>('[data-sv-identity]')].filter(
        (inner) => !element.contains(inner.parentElement?.closest('[data-sv-identity]') ?? null)
      );
      return values.length === 1
        ? [
            {
              element,
              box: element.getBoundingClientRect(),
              holds: values[0].dataset.svIdentity ?? '',
              value: values[0]
            }
          ]
        : [];
    }
  );
}

/** The kinds of the nodes around an element, nearest first: where it is drawn, as a role. */
function roleOf(element: HTMLElement, layer: HTMLElement): string[] {
  const kinds: string[] = [];
  for (let node = element.parentElement; node && node !== layer; node = node.parentElement)
    if (node.dataset.svKind) kinds.push(node.dataset.svKind);
  return kinds;
}

/** How many of two roles' kinds agree, nearest first, up to the first that differs. */
function sharedRole(a: readonly string[], b: readonly string[]): number {
  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared += 1;
  return shared;
}

/**
 * Each place a value is drawn now paired with a place it was drawn before, the pairs sharing the
 * most of their roles first, each place used once, in document order where roles tie; where the
 * value is drawn in more places now, the new places left over pair with none.
 */
export function pairByRole(
  now: readonly (readonly string[])[],
  before: readonly (readonly string[])[]
): (number | undefined)[] {
  const candidates = now
    .flatMap((role, fresh) =>
      before.map((other, old) => ({ fresh, old, shared: sharedRole(role, other) }))
    )
    .toSorted((a, b) => b.shared - a.shared || a.fresh - b.fresh || a.old - b.old);
  const pairs: (number | undefined)[] = now.map(() => undefined);
  const used = new Set<number>();
  for (const { fresh, old } of candidates) {
    if (pairs[fresh] !== undefined || used.has(old)) continue;
    pairs[fresh] = old;
    used.add(old);
  }
  return pairs;
}

/** Whether two boxes are in the same place, at the same size, but for rounding. */
const samePlace = (a: DOMRect, b: DOMRect): boolean =>
  Math.abs(a.left - b.left) < still &&
  Math.abs(a.top - b.top) < still &&
  Math.abs(a.width - b.width) < still &&
  Math.abs(a.height - b.height) < still;

/**
 * The identity a copied value was copied from, as 29 for 31 where 31 is a copy of 29; for a value
 * read through a position (see movingIdentity), its place's, with the rest, as 29.seen for 31.seen.
 */
function copiedFrom(
  identity: string,
  copies: Readonly<Record<number, number>>
): string | undefined {
  const [, place = '', below = ''] = /^(\d+)(.*)$/su.exec(identity) ?? [];
  const copied = copies[Number(place)];
  return copied === undefined ? undefined : `${copied}${below}`;
}

/** How much an element is scaled on screen, by the frame's fit, any ancestor's and its own. */
function scaleOf(element: HTMLElement, box: DOMRect): number {
  return element.offsetWidth ? box.width / element.offsetWidth : 1;
}

/** How much an element's own transform scales it, as a pointer's scale does (see Node). */
function ownScale(element: HTMLElement): number {
  const transform = getComputedStyle(element).transform;
  if (!transform || transform === 'none') return 1;
  const matrix = new DOMMatrixReadOnly(transform);
  return Math.hypot(matrix.a, matrix.b) || 1;
}

/** Scales this close to one are rounding, not a change of size. */
const unscaled = 0.01;

/** The paint a node changes between steps, each interpolated from its old value to its new. */
const paintProperties = [
  'backgroundColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'color',
  'boxShadow',
  'opacity',
  'outlineColor',
  'outlineWidth',
  'outlineOffset'
] as const;

const pixels = (value: string) => Number.parseFloat(value) || 0;

/** The size and paint a node shows now, copied, so later animations do not change it. */
type Look = Record<(typeof lookProperties)[number], string>;

const lookProperties = [
  ...paintProperties,
  'outlineStyle',
  'width',
  'height',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'marginRight',
  'marginBottom'
] as const;

function snapshot(element: HTMLElement): Look {
  const style = getComputedStyle(element);
  return Object.fromEntries(lookProperties.map((property) => [property, style[property]])) as Look;
}

/** A shadow list's shadows, split at the commas between them, not those inside a colour. */
function shadows(list: string): string[] {
  if (list === 'none') return [];
  const found: string[] = [];
  let depth = 0;
  let start = 0;
  for (let at = 0; at < list.length; at++) {
    if (list[at] === '(') depth++;
    else if (list[at] === ')') depth--;
    else if (list[at] === ',' && depth === 0) {
      found.push(list.slice(start, at).trim());
      start = at + 1;
    }
  }
  return [...found, list.slice(start).trim()];
}

/** A shadow drawn as a sharp ring round the box, a spread with no offset or blur, as `0 0 0 6px`. */
const ring = /^(.*?)\s*0px 0px 0px (-?[\d.]+)px$/u;

/**
 * A shadow list with the rings the other list draws and this one does not, at no spread: a ring
 * appearing or going then grows from the box or shrinks into it in its own colour, where
 * interpolating with none would fade it out. Other shadows, as a lifted or soft one, still fade.
 */
function withRings(list: string, other: string): string {
  const own = shadows(list);
  const missing = shadows(other)
    .slice(own.length)
    .map((shadow) => ring.exec(shadow))
    .filter((match) => match !== null)
    .map((match) => `${match[1]} 0px 0px 0px 0px`);
  return [...own, ...missing].join(', ') || 'none';
}

/**
 * Keyframes taking a node's paint from what it showed before to what it shows now, or none where
 * nothing changed. An outline appearing or going keeps one style throughout, its width running
 * from or to 0, so it grows or shrinks instead of flipping halfway.
 */
function paintFrames(was: Look, is: Look): Keyframe[] | undefined {
  const from: Keyframe = {};
  const to: Keyframe = {};
  for (const property of paintProperties)
    if (was[property] !== is[property]) {
      from[property] = was[property];
      to[property] = is[property];
    }
  if (was.boxShadow !== is.boxShadow) {
    from.boxShadow = withRings(was.boxShadow, is.boxShadow);
    to.boxShadow = withRings(is.boxShadow, was.boxShadow);
  }
  if (was.outlineStyle !== is.outlineStyle) {
    const drawn = is.outlineStyle === 'none' ? was : is;
    from.outlineStyle = to.outlineStyle = drawn.outlineStyle;
    from.outlineWidth = was.outlineStyle === 'none' ? '0px' : was.outlineWidth;
    to.outlineWidth = is.outlineStyle === 'none' ? '0px' : is.outlineWidth;
    from.outlineColor = was.outlineStyle === 'none' ? 'transparent' : was.outlineColor;
    to.outlineColor = is.outlineStyle === 'none' ? 'transparent' : is.outlineColor;
  }
  return Object.keys(from).length ? [from, to] : undefined;
}

/**
 * Keyframes taking a node's box from its old size to its new, or none where it kept its size. Its
 * margins make up the difference at every frame, so its layout keeps the new size and nothing
 * around it reflows: its neighbours move by their own translations, and with the box translated
 * from its old place to its new, each edge runs straight between the two, so it grows about the
 * anchor that placed it. Its least sizes give way while it does, and what it holds is laid out
 * afresh at each size, never scaled.
 */
function sizeFrames(was: Look, is: Look): Keyframe[] | undefined {
  const width = pixels(is.width) - pixels(was.width);
  const height = pixels(is.height) - pixels(was.height);
  if (Math.abs(width) < still && Math.abs(height) < still) return undefined;
  const sides = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const;
  const from: Keyframe = {
    width: was.width,
    height: was.height,
    minWidth: '0px',
    minHeight: '0px'
  };
  const to: Keyframe = { width: is.width, height: is.height, minWidth: '0px', minHeight: '0px' };
  for (const side of sides) {
    from[side] = was[side];
    to[side] = is[side];
  }
  from.marginRight = `${pixels(is.marginRight) + width}px`;
  to.marginRight = is.marginRight;
  from.marginBottom = `${pixels(is.marginBottom) + height}px`;
  to.marginBottom = is.marginBottom;
  return [from, to];
}

/**
 * Animate the change from the layer shown before to the one shown now: moves and fades in `after`,
 * and the values gone marked in `before` for leaveLayer. `copies` gives the source of each value
 * copied at this step, by identity, when `after` is the step following `before`.
 */
export function animateStep(
  before: HTMLElement,
  after: HTMLElement,
  copies: Readonly<Record<number, number>>
): { gone: HTMLElement[] } {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return { gone: [] };
  const old = placedByIdentity(before);
  const now = placedByIdentity(after);

  // Where each node starts, as a move from its old box on screen; new ones fade in.
  // A node shown at another scale than before, as one a pointer scales or no longer does, starts at
  // its old scale too, so it grows or shrinks as it moves.
  const moves = new Map<
    HTMLElement,
    { x: number; y: number; scale: number; grown: number; source: HTMLElement }
  >();
  const appearing: HTMLElement[] = [];
  const paired = new Set<HTMLElement>();
  for (const [identity, placed] of now) {
    const same = old.get(identity);
    const from = same ?? old.get(copiedFrom(identity, copies) ?? '');
    // Each place pairs with the old place of the value, or of the value it copies, drawn most alike;
    // a place left over fades in where it is.
    const pairs = from
      ? pairByRole(
          placed.map(({ element }) => roleOf(element, after)),
          from.map(({ element }) => roleOf(element, before))
        )
      : [];
    placed.forEach(({ element, box }, index) => {
      const pair = pairs[index];
      const source = pair === undefined ? undefined : from?.[pair];
      if (!source) return appearing.push(element);
      if (same) paired.add(source.element);
      const grown = scaleOf(source.element, source.box) / scaleOf(element, box);
      const resized = Math.abs(grown - 1) >= unscaled;
      // Scaled about its transform origin, which keeps its place in the box, then moved so the box
      // starts exactly where the old one was.
      const [originX, originY] = getComputedStyle(element)
        .transformOrigin.split(' ')
        .map((length) => Number.parseFloat(length));
      const origin = {
        x: box.left + (element.offsetWidth ? originX / element.offsetWidth : 0.5) * box.width,
        y: box.top + (element.offsetHeight ? originY / element.offsetHeight : 0.5) * box.height
      };
      moves.set(element, {
        x: resized
          ? source.box.left - origin.x - grown * (box.left - origin.x)
          : source.box.left - box.left,
        y: resized
          ? source.box.top - origin.y - grown * (box.top - origin.y)
          : source.box.top - box.top,
        scale: scaleOf(element, box) / ownScale(element),
        grown: resized ? grown : 1,
        source: source.element
      });
    });
  }

  // A frame around one value that moved, as a cell crossing from the unsorted part to the sorted,
  // is a new node no identity pairs: it moves with its value, so the value never leaves it and it
  // never waits empty where the value lands, its paint blending from the frame that held the same
  // value before, where one did. A frame in the same place as one before is paired by place below.
  const oldFrames = framesOf(before);
  const newFrames = framesOf(after);
  for (const { element, box, holds, value } of newFrames) {
    const carried = moves.get(value);
    if (!carried || oldFrames.some((frame) => samePlace(frame.box, box))) continue;
    const held = [holds, copiedFrom(holds, copies)];
    const sources = oldFrames.filter((frame) => held.includes(frame.holds));
    moves.set(element, {
      x: carried.x,
      y: carried.y,
      scale: scaleOf(element, box) / ownScale(element),
      grown: 1,
      source: sources.length === 1 ? sources[0].element : element
    });
  }

  // Each node's old and new size and paint, read before anything here animates, as a parent's
  // colour animating would change what its children inherit.
  const styles = new Map(
    [...moves].map(([element, { source }]) => [
      element,
      { was: snapshot(source), is: snapshot(element) }
    ])
  );
  // A frame around one value, in the same place, drawn as another kind than before, as a cell an
  // {#if} draws as sorted or unsorted, fades from its old paint to its new: it is a new node, which
  // no identity pairs, so it would otherwise switch at once.
  const reframed = newFrames.flatMap(({ element, box }) => {
    if (moves.has(element)) return [];
    const was = oldFrames.find(
      (frame) =>
        samePlace(frame.box, box) && frame.element.dataset.svKind !== element.dataset.svKind
    );
    return was ? [{ element, look: { was: snapshot(was.element), is: snapshot(element) } }] : [];
  });
  const timing = { duration: motionDuration, easing };
  // A node inside one that moves moves with it, so it is translated only by the difference.
  for (const [element, move] of moves) {
    let outer: { x: number; y: number } | undefined;
    for (let parent = element.parentElement; parent && !outer; parent = parent.parentElement)
      outer = moves.get(parent);
    const x = (move.x - (outer?.x ?? 0)) / move.scale;
    const y = (move.y - (outer?.y ?? 0)) / move.scale;
    if (move.grown !== 1)
      element.animate(
        [
          { translate: `${x}px ${y}px`, scale: `${move.grown}` },
          { translate: '0 0', scale: '1' }
        ],
        timing
      );
    else if (Math.abs(x) >= still || Math.abs(y) >= still)
      element.animate([{ translate: `${x}px ${y}px` }, { translate: '0 0' }], timing);
    const { was, is } = styles.get(element)!;
    const paint = paintFrames(was, is);
    if (paint) element.animate(paint, timing);
    // Only a node holding no other the steps match changes size: inside one that does, what it
    // holds is placed by its new size and moves on its own.
    const size = element.querySelector('[data-sv-identity]') ? undefined : sizeFrames(was, is);
    if (size) element.animate(size, timing);
  }
  for (const { element, look } of reframed) {
    const paint = paintFrames(look.was, look.is);
    if (paint) element.animate(paint, timing);
  }
  // A part of a value that moves, as a card's name where only the name was drawn before, rides
  // with it in view; anything else new fades in.
  const ridesWith = (element: HTMLElement): boolean => {
    const outer = element.parentElement?.closest<HTMLElement>('[data-sv-identity]');
    if (!outer || !element.dataset.svIdentity?.startsWith(`${outer.dataset.svIdentity}.`))
      return false;
    return moves.has(outer) || ridesWith(outer);
  };
  // A frame new here around a value that appears, as a caption's sentence around a name, fades in
  // with it, as one.
  const fading = new Set(appearing.filter((element) => !ridesWith(element)));
  for (const { element, box, value } of newFrames)
    if (fading.has(value) && !oldFrames.some((frame) => samePlace(frame.box, box))) {
      fading.delete(value);
      fading.add(element);
    }
  for (const element of fading)
    element.animate([{ opacity: 0 }, { opacity: getComputedStyle(element).opacity }], {
      duration: motionDuration,
      easing
    });

  // A link drawn anew, or along another route, is drawn where its ends will be once the moves end,
  // so while a pointer's caption or a node is still moving it would hang in empty space: it waits
  // for the moves, then fades in.
  const routes = (layer: HTMLElement) =>
    [...layer.querySelectorAll<SVGPathElement>('path[data-sv-edge]')].map((path) => ({
      path,
      key: path.dataset.svEdgeId ?? path.dataset.svEdge ?? '',
      route: path.getAttribute('d') ?? ''
    }));
  const redrawn = rerouted(routes(before), routes(after));
  for (const { path } of redrawn)
    path.animate([{ opacity: 0 }, { opacity: 0, offset: 0.6 }, { opacity: 1 }], {
      duration: motionDuration,
      easing
    });

  // Gone too: a value drawn in a place before that no place now pairs with.
  const gone = [...old].flatMap(([identity, placed]) =>
    now.has(identity)
      ? placed.filter(({ element }) => !paired.has(element)).map(({ element }) => element)
      : placed.map(({ element }) => element)
  );
  for (const element of gone) element.dataset.svGone = '';
  return { gone };
}

/** The links of the step shown now that the one before drew elsewhere, or not at all, by key. */
export function rerouted<T extends { key: string; route: string }>(
  before: readonly { key: string; route: string }[],
  after: readonly T[]
): T[] {
  const was = new Map(before.map(({ key, route }) => [key, route]));
  return after.filter(({ key, route }) => was.get(key) !== route);
}

/**
 * Keep the layer shown before over the new one while its gone values fade out, then call `done`
 * to remove it. Everything else in it is hidden at once.
 */
export function leaveLayer(layer: HTMLElement, gone: HTMLElement[], done: () => void): void {
  if (!gone.length) return done();
  layer.classList.add('sv-leaving');
  const fades = gone.map((element) =>
    element.animate([{ opacity: getComputedStyle(element).opacity }, { opacity: 0 }], {
      duration: motionDuration,
      easing,
      fill: 'forwards'
    })
  );
  void Promise.allSettled(fades.map((fade) => fade.finished)).then(done);
}

/** Finish every move and fade still running in a layer, so it is measured where it ends. */
export function finishMotion(layer: HTMLElement): void {
  for (const animation of layer.getAnimations({ subtree: true })) animation.finish();
}
