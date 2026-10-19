/**
 * The `sverlin` module: ../assembly/prelude.ts imports Node from it into every authored component,
 * and ../assembly/entry.ts mounts every view inside Frame.
 */

export { default as Frame } from './Frame.svelte';
export { default as Link } from './node/Link.svelte';
export { default as Node } from './node/Node.svelte';
export { default as Pointed } from './node/Pointed.svelte';
export { default as SverlinSlot } from './node/Slot.svelte';
export { themeCss } from './theme';
export type {
  Align,
  FrameRatio,
  FrameSettings,
  Justify,
  Layout,
  MinSize,
  NodeColor,
  NodeDefaults,
  NodeFont,
  NodeProps,
  NodeShape,
  NodeSize,
  NodeStroke,
  PaletteColor,
  Primitive,
  Radius,
  Spacing,
  StrokeWidth,
  Weight
} from './node/props';
export type { LayoutMemory } from './type-context';
export { providePointers } from './type-context';
export { settleSpans } from './node/span';
export { widestInteger } from './widest-number';
export { describeFrame, describeStep } from './scene';
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
