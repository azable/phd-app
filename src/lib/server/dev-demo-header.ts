/** The header lines a /dev/demo example starts with (see dev-demo.ts). */

/** An example's source without its header lines, and what they say. */
export function withoutHeader(text: string): {
  source: string;
  summary?: string;
  parent?: string;
  variant?: string;
  note?: string;
} {
  const header: Record<string, string> = {};
  const source = text.replace(
    /^(?:\s*<!--\s*(summary|parent|variant|note):\s*(.*?)\s*-->\s*\n)+/u,
    (lines) => {
      for (const [, key, value] of lines.matchAll(
        /<!--\s*(summary|parent|variant|note):\s*(.*?)\s*-->/gu
      ))
        header[key] = value;
      return '';
    }
  );
  return { source, ...header };
}
