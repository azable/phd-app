/**
 * The `sverlin` module: ../assembly/prelude.ts imports Node from it into every authored component,
 * and ../assembly/entry.ts mounts every view inside Frame.
 */

export { default as Frame } from './Frame.svelte';
export { default as Link } from './node/Link.svelte';
export { default as Listing } from './listing/Listing.svelte';
export { default as Node } from './node/Node.svelte';
export { default as Pointed } from './node/Pointed.svelte';
export { default as SverlinBranch } from './node/Branch.svelte';
export { default as SverlinChain } from './node/Chain.svelte';
export { default as SverlinSlot } from './node/Slot.svelte';
export { themeCss } from './theme';
export type { Align, FrameRatio, FrameSettings, Justify, Layout, Primitive } from './node/props';
export { kindKey, type DesignValues } from './node/design';
export type { LayoutMemory } from './type-context';
export { provideEnds, providePointers } from './type-context';
export { settleSpans } from './node/span';
export { widestInteger } from './widest-number';
export { unpackStates, type PackedStates } from './trace-pack';
export { arrangementLayout, describeFrame, describeStep } from './scene';
export { animateStep, finishMotion, leaveLayer, motionCss } from './motion';
export type {
  SceneBox,
  SceneFrame,
  SceneLink,
  SceneLook,
  SceneNode,
  ScenePoint,
  SceneStep,
  SceneText
} from './scene';
