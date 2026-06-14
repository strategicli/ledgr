// One source of truth for chord-chart styling, shared by every render surface:
// the in-app canvas (ChordCanvas injects it in a <style>) and the self-contained
// print/share document (print-html.ts inlines it into DOC_CSS). Keyed off the
// cc-* class names render.ts emits. Lyric lines are flex rows of stacked cells
// (chord over its syllable) that wrap naturally; the chart body flows two
// columns like the reference PraiseCharts.
export const CHART_CSS = `
.cc-chart{font-family:system-ui,-apple-system,sans-serif;color:inherit}
.cc-head{margin-bottom:1rem;padding-bottom:.5rem;border-bottom:1px solid #333}
.cc-title{font-size:1.7rem;font-weight:700;line-height:1.15}
.cc-artist{color:#a3a3a3;font-size:.95rem;margin-top:.1rem}
.cc-meta{color:#a3a3a3;font-size:.9rem;margin-top:.25rem}
.cc-body{column-count:2;column-gap:2rem}
.cc-section{break-inside:avoid;margin:0 0 1rem;display:block}
.cc-label{font-weight:700;text-decoration:underline;margin-bottom:.25rem}
.cc-ref .cc-label{color:#737373;font-weight:600}
.cc-line{margin-bottom:.1rem}
.cc-lyric{display:flex;flex-wrap:wrap;align-items:flex-end}
.cc-cell{display:inline-flex;flex-direction:column;white-space:pre}
.cc-chord{font-weight:700;color:#7cb3ff;font-size:.8rem;line-height:1.1;min-height:1.1em}
.cc-text{line-height:1.25}
.cc-bars{font-family:ui-monospace,Consolas,monospace;color:#d4d4d4}
.cc-pipe{color:#737373;margin:0 .35rem}
.cc-beat{color:#737373}
.cc-comment{font-style:italic;color:#a3a3a3;margin:.15rem 0}
@media print{
  .cc-head{border-color:#bbb}
  .cc-title{color:#111}
  .cc-artist,.cc-meta{color:#444}
  .cc-chord{color:#1a4d8f}
  .cc-bars{color:#222}
  .cc-pipe,.cc-beat{color:#888}
}
`;
