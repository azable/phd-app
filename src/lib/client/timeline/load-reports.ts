/** One-line summaries of presentation load reports, for developer view. */

import type { PresentationLoadTiming } from '$lib/shared/presentation-load-timing';

/**
 * How a presentation loaded, in one line: "server layout · 84 ms · Chrome/macOS · 2×", or for a
 * stalled load, where it waits.
 */
export function loadReportLine(report: PresentationLoadTiming): string {
  const waiting = report.last
    ? `${report.last.phase}${report.last.step === undefined ? '' : ` step ${report.last.step + 1}`}`
    : 'no pass';
  return [
    report.outcome === 'stalled' ? `stalled at ${waiting}` : undefined,
    report.layout ? `${report.layout} layout` : undefined,
    `${report.sinceLoadMs} ms`,
    report.fonts && !report.fonts.loaded ? 'fonts failed' : undefined,
    report.userAgent ? browserOf(report.userAgent) : undefined,
    report.devicePixelRatio === undefined ? undefined : `${report.devicePixelRatio}×`
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The browser and system a user agent names, as "Chrome/macOS"; the full string is in the report. */
export function browserOf(userAgent: string): string {
  const browser = /Edg\//u.test(userAgent)
    ? 'Edge'
    : /Firefox\//u.test(userAgent)
      ? 'Firefox'
      : /Chrom(e|ium)\//u.test(userAgent)
        ? 'Chrome'
        : /Safari\//u.test(userAgent)
          ? 'Safari'
          : 'Other';
  const system = /iPhone|iPad/u.test(userAgent)
    ? 'iOS'
    : /Android/u.test(userAgent)
      ? 'Android'
      : /Mac OS X|Macintosh/u.test(userAgent)
        ? 'macOS'
        : /Windows/u.test(userAgent)
          ? 'Windows'
          : /Linux|CrOS/u.test(userAgent)
            ? 'Linux'
            : 'other';
  return `${browser}/${system}`;
}
