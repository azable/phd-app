// Fixed browser entry for every presentation: each step drawn with SceneView from the scene the
// server drew (see layout.ts and ../library/model/scene-of.ts), which the app sends as the page
// asks for it (see ../Viewport.svelte); no authored code runs here. The sandbox document injects
// the first step and selection; later steps arrive as messages and are shown without reloading.

import { mount } from 'svelte';
import { pageCss, SceneView, type SceneFrame, type SceneStep } from 'sverlin/scenes';
import { stepCount } from 'virtual:steps';

const playback = window as typeof window & {
  __sverlinStep?: number;
  __sverlinSelection?: unknown;
  /** The zoom and pan the app restores, as it last had them (see sandboxDocument). */
  __sverlinView?: { zoom?: number; panX?: number; panY?: number };
};
const clampStep = (step: number) => Math.min(Math.max(step, 0), stepCount - 1);
// To the app; a page shown on its own, as a test opens it, is its own parent.
const post = (message: object) => window.parent.postMessage(message, '*');

// The page theme every node draws on: colour tokens, the canvas, and spacing for the page itself.
const theme = document.createElement('style');
theme.textContent = pageCss;
document.head.append(theme);
const root = document.getElementById('app') ?? document.body;
const pageStarted = performance.now();

/**
 * The embedded fonts every text is drawn in, which the server measured it in, loaded before any
 * step is drawn, so text is never drawn in a font the page falls back to while they load; whether
 * every one loaded. The sandbox document declares them (see ../fonts).
 */
async function loadFonts(): Promise<boolean> {
  const faces = [...document.fonts];
  const loaded = await Promise.all(
    faces.map((face) =>
      face.load().then(
        () => true,
        () => false
      )
    )
  );
  return faces.length > 0 && loaded.every(Boolean);
}
/** The embedded fonts' version, as the sandbox document names it. */
const fonts = document.querySelector<HTMLMetaElement>('meta[name="sverlin-fonts"]')?.content;

/**
 * Report how wide this page sets a sample text in each embedded font, at the sizes text is drawn
 * at, so the app's load report can be compared with the server's measure of the same text. It
 * takes about a millisecond.
 */
function reportFontWidths(loaded: boolean) {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return;
  const sample = '0123456789 Hamburgefonstiv ∞→';
  const widths: Record<string, number> = {};
  for (const family of new Set([...document.fonts].map((face) => face.family.replace(/"/gu, ''))))
    for (const weight of [400, 700])
      for (const size of [16, 13.6]) {
        context.font = `${weight} ${size}px "${family}"`;
        widths[`${family} ${weight} ${size}`] = +context.measureText(sample).width.toFixed(4);
      }
  post({
    type: 'sverlin:fonts',
    ...(fonts ? { version: fonts } : {}),
    loaded,
    sample,
    widths,
    devicePixelRatio: window.devicePixelRatio
  });
}
const fontsLoaded = loadFonts().then(reportFontWidths);

// Each step's scene, asked of the app once, the steps asked in the same task asked together.
let sceneFrame: SceneFrame | undefined;
const scenes = new Map<number, Promise<SceneStep>>();
const awaited = new Map<
  number,
  { take: (scene: SceneStep) => void; fail: (cause: Error) => void }
>();
let wanted: number[] = [];

function sceneOf(step: number): Promise<SceneStep> {
  let scene = scenes.get(step);
  if (scene) return scene;
  if (!wanted.length)
    queueMicrotask(() => {
      post({ type: 'sverlin:scenes-wanted', steps: wanted });
      wanted = [];
    });
  wanted.push(step);
  scene = new Promise<SceneStep>((take, fail) => awaited.set(step, { take, fail }));
  scenes.set(step, scene);
  return scene;
}

/** Scenes the app sent: some steps', or why the server has none, which the app shows. */
function takeScenes(data: { frame?: unknown; steps?: unknown; failure?: unknown }) {
  if (typeof data.failure === 'string' || !Array.isArray(data.steps)) {
    const failure = new Error(typeof data.failure === 'string' ? data.failure : 'No scenes.');
    for (const { fail } of awaited.values()) fail(failure);
    awaited.clear();
    scenes.clear();
    return;
  }
  sceneFrame ??= data.frame as SceneFrame;
  for (const [step, scene] of data.steps as [number, SceneStep][]) {
    awaited.get(step)?.take(scene);
    awaited.delete(step);
  }
}

type ScenePlayer = {
  show(step: number, scene: SceneStep): void;
  select(ids: readonly string[]): void;
  annotate(pins: readonly unknown[]): void;
  compose(on: CommentOn | undefined): void;
};
let player: ScenePlayer | undefined;
let ready = false;
// The step last asked for, under the number asked, which a test waits for, though a step past the
// last shows the last; and a count of asks, so a scene arriving late for an older ask is not shown.
let asked = playback.__sverlinStep ?? 0;
let showing = 0;
const reported = new Set<string>();

async function showStep(step: number) {
  const token = ++showing;
  delete root.dataset.svSettled;
  await fontsLoaded;
  const scene = await sceneOf(step).catch(() => undefined);
  if (!scene || token !== showing) return;
  // A step the view failed to draw on the server is reported once, as the view's own failure.
  if (scene.error && !reported.has(`${step}`)) {
    reported.add(`${step}`);
    post({ type: 'sverlin:error', message: scene.error, step });
  }
  player ??= mountPlayer();
  player.show(step, scene);
  for (const near of [step + 1, step - 1])
    if (near >= 0 && near < stepCount) void sceneOf(near).catch(() => undefined);
}

// The comment pins the app last sent, and what the comment being written is on, if one is, shown
// once the player mounts.
type CommentOn = { elements?: string[]; point?: { x: number; y: number } };
type Pin = CommentOn & { n: number; text: string };
let pins: Pin[] = [];
let composing: CommentOn | undefined;
const isPin = (pin: unknown): pin is Pin =>
  typeof pin === 'object' &&
  pin !== null &&
  typeof (pin as Pin).n === 'number' &&
  typeof (pin as Pin).text === 'string';

function mountPlayer(): ScenePlayer {
  return mount(SceneView, {
    target: root,
    props: {
      frame: sceneFrame ?? { width: 1200, height: 675, background: '#fff' },
      selection: Array.isArray(playback.__sverlinSelection)
        ? playback.__sverlinSelection.map(String)
        : [],
      view: playback.__sverlinView,
      pins,
      composing,
      onselection: (elements: unknown[]) => post({ type: 'sverlin:selection', elements }),
      onpoint: (point: { x: number; y: number }) => post({ type: 'sverlin:point', ...point }),
      oncomment: (text: string) => post({ type: 'sverlin:comment', text }),
      oncomposecancel: () => post({ type: 'sverlin:compose-cancel' }),
      onview: (view: { zoom: number; panX: number; panY: number }) => {
        playback.__sverlinView = view;
        post({ type: 'sverlin:view', ...view });
      },
      onsettled: () => {
        if (!ready) {
          ready = true;
          post({
            type: 'sverlin:timing',
            phase: 'ready',
            ms: Math.round(performance.now() - pageStarted)
          });
          post({ type: 'sverlin:ready' });
        }
        const token = showing;
        void document.fonts.ready.then(() => {
          if (token === showing) root.dataset.svSettled = String(asked);
        });
      }
    }
  }) as unknown as ScenePlayer;
}

// The app sends each new step, with the selection to show in it, the scenes the page asked for,
// and selections to show, as when a participant opens a reference.
addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window.parent) return;
  const data = event.data as {
    type?: unknown;
    step?: unknown;
    selection?: unknown;
    ids?: unknown;
    pins?: unknown;
    on?: unknown;
  };
  if (data?.type === 'sverlin:pins') {
    pins = Array.isArray(data.pins) ? data.pins.filter(isPin) : [];
    return player?.annotate(pins);
  }
  if (data?.type === 'sverlin:compose') {
    const on = data.on as CommentOn | null | undefined;
    composing =
      typeof on === 'object' && on !== null
        ? {
            ...(Array.isArray(on.elements) ? { elements: on.elements.map(String) } : {}),
            ...(on.point ? { point: on.point } : {})
          }
        : undefined;
    return player?.compose(composing);
  }
  if (data?.type === 'sverlin:scenes') return takeScenes(data as Parameters<typeof takeScenes>[0]);
  if (data?.type === 'sverlin:select')
    return player?.select(Array.isArray(data.ids) ? data.ids.map(String) : []);
  if (data?.type !== 'sverlin:step' || typeof data.step !== 'number') return;
  playback.__sverlinSelection = Array.isArray(data.selection) ? data.selection : [];
  if (Array.isArray(data.selection)) player?.select(data.selection.map(String));
  asked = data.step;
  void showStep(clampStep(data.step));
});

post({ type: 'sverlin:loaded' });
void showStep(clampStep(asked));
