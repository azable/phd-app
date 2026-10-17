/** Render targets: the kinds of file a presentation can be exported as, each offered by its mode. */

export type RenderTarget = {
  id: string;
  /** How the export menu names it. */
  title: string;
  /** Whether the file plays the steps, rather than showing each as a still. */
  animated: boolean;
};

export type RenderedFile = { name: string; blob: Blob };
