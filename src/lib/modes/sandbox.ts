/** Render executable artifacts in an opaque-origin iframe with a restrictive CSP. */

/** A canvas view (zoom and pan) a presentation reported, restored when the frame reloads. */
export type CanvasView = { zoom: number; panX: number; panY: number };

export function sandboxDocument(
  html: string,
  javascript: string,
  step = 0,
  seed = 1,
  view?: CanvasView,
  selection?: readonly string[],
  /** Markup for the head, after its own, such as the fonts a mode embeds. */
  head = ''
): string {
  const policy = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    'img-src data:',
    'font-src data:',
    "connect-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ');
  const script =
    `window.__sverlinStep=${JSON.stringify(step)};window.__sverlinSeed=${JSON.stringify(seed)};${view ? `window.__sverlinView=${JSON.stringify({ zoom: Number(view.zoom), panX: Number(view.panX), panY: Number(view.panY) })};` : ''}${selection?.length ? `window.__sverlinSelection=${JSON.stringify(selection.map(String))};` : ''}\n${javascript}`.replace(
      /<\/script/giu,
      '<\\/script'
    );
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html,body{width:100%;height:100%;margin:0;overflow:hidden;font-family:system-ui,sans-serif}</style>${head}</head><body><div id="app">${html}</div><script>${script}</script></body></html>`;
}
