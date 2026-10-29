/**
 * Moving from one step to the next. Each step is drawn in a layer of its own, laid out before it
 * shows, so a node drawing the same value, or the same pointer, in both layers (data-sv-identity)
 * starts where it was and moves to its new place: it is drawn in place and translated back, then
 * the translation runs out. A copy of a value starts where its source was; a new value fades in,
 * unless it is part of one that moves; a value gone fades out with the layer it was in, kept over
 * the new one until then.
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

/** How much an element is scaled on screen, by the frame's fit and any ancestor's. */
function scaleOf(element: HTMLElement, box: DOMRect): number {
  return element.offsetWidth ? box.width / element.offsetWidth : 1;
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
  const moves = new Map<HTMLElement, { x: number; y: number; scale: number }>();
  const appearing: HTMLElement[] = [];
  for (const [identity, placed] of now) {
    const from = old.get(identity) ?? old.get(copiedFrom(identity, copies) ?? '');
    placed.forEach(({ element, box }, index) => {
      const source = from?.[Math.min(index, from.length - 1)];
      if (!source) appearing.push(element);
      else
        moves.set(element, {
          x: source.box.left - box.left,
          y: source.box.top - box.top,
          scale: scaleOf(element, box)
        });
    });
  }

  // A node inside one that moves moves with it, so it is translated only by the difference.
  for (const [element, move] of moves) {
    let outer: { x: number; y: number } | undefined;
    for (let parent = element.parentElement; parent && !outer; parent = parent.parentElement)
      outer = moves.get(parent);
    const x = (move.x - (outer?.x ?? 0)) / move.scale;
    const y = (move.y - (outer?.y ?? 0)) / move.scale;
    if (Math.abs(x) < still && Math.abs(y) < still) continue;
    element.animate([{ translate: `${x}px ${y}px` }, { translate: '0 0' }], {
      duration: motionDuration,
      easing
    });
  }
  // A part of a value that moves, as a card's name where only the name was drawn before, rides
  // with it in view; anything else new fades in.
  const ridesWith = (element: HTMLElement): boolean => {
    const outer = element.parentElement?.closest<HTMLElement>('[data-sv-identity]');
    if (!outer || !element.dataset.svIdentity?.startsWith(`${outer.dataset.svIdentity}.`))
      return false;
    return moves.has(outer) || ridesWith(outer);
  };
  for (const element of appearing.filter((element) => !ridesWith(element)))
    element.animate([{ opacity: 0 }, { opacity: getComputedStyle(element).opacity }], {
      duration: motionDuration,
      easing
    });

  // Gone too: a value drawn more times before than now, its last ones, which no node pairs with.
  const gone = [...old].flatMap(([identity, placed]) =>
    placed.slice(now.get(identity)?.length ?? 0).map(({ element }) => element)
  );
  for (const element of gone) element.dataset.svGone = '';
  return { gone };
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
