// S1 verification: the pure ChordPro core (parse / serialize / render / text /
// transpose). Running this file in plain node IS the proof the module stays
// import-pure (no React, no markdown-it, no DB). Mirrors the check() harness of
// verify-module-registry.mts.
//
//   npx tsx scripts/verify-chordpro.mts
import { parseChordPro, serializeChordChart } from "../src/lib/chordpro/parse";
import { chartToHtml } from "../src/lib/chordpro/render";
import { chordProToText } from "../src/lib/chordpro/render-text";
import {
  keyOfCapo,
  transposeChord,
  transposeNote,
} from "../src/lib/chordpro/transpose";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}
const json = (x: unknown) => JSON.stringify(x);

// ── Fixtures (representative of the two reference PraiseCharts songs) ──────────
const THIS_IS_OUR_GOD = `{title: This Is Our God}
{artist: Phil Wickham}
{key: Bb}
{capo: 3}
{tempo: 80}
{time: 4/4}
{ccli: 7211413}

{section: Intro}
| G / / / | Gsus / G / |

{section: Verse 1}
[G]Remember those walls
That we called sin and shame

{section: Chorus}
[G/B]This is our [C2]God, this is who He [G]is
He [G/D]loves [D]us

{section: Verse 2}
[G]Remember those giants
We called [Gsus]death and [G]grave

{repeat: Chorus}`;

const ALL_SUFFICIENT_MERIT = `{title: All Sufficient Merit (Live)}
{artist: Shane & Shane}
{key: Bb}
{capo: 3}
{tempo: 147}
{time: 6/8}

{section: Verse 1}
[Em]All [D]suf - ficient [C G/B]mer - it
[C]Shining like the [Dsus]sun

{section: Chorus 1}
It is [D]done, it is [Em Bm7]fin - ished
[C]No more debt I [G]owe`;

// ── 1. Round-trip: parse(serialize(parse(x))) deep-equals parse(x) ────────────
function roundTrips(src: string): boolean {
  const once = parseChordPro(src);
  const twice = parseChordPro(serializeChordChart(once));
  return json(once) === json(twice);
}
check("round-trip: This Is Our God", roundTrips(THIS_IS_OUR_GOD));
check("round-trip: All Sufficient Merit", roundTrips(ALL_SUFFICIENT_MERIT));

// ── 2. Directive extraction ───────────────────────────────────────────────────
const tiog = parseChordPro(THIS_IS_OUR_GOD);
check("title parsed", tiog.meta.title === "This Is Our God");
check("artist parsed", tiog.meta.artist === "Phil Wickham");
check("key parsed", tiog.meta.key === "Bb");
check("capo parsed as number", tiog.meta.capo === 3);
check("tempo parsed as number", tiog.meta.tempo === 80);
check("time parsed", tiog.meta.time === "4/4");
check("ccli parsed", tiog.meta.ccli === "7211413");

// ── 3. Chord/syllable attachment (hyphen-split lyrics) ────────────────────────
const merit = parseChordPro(ALL_SUFFICIENT_MERIT);
const v1 = merit.sections.find((s) => s.label === "Verse 1");
const firstLyric = v1?.lines.find((l) => l.kind === "lyric");
const pairs = firstLyric && firstLyric.kind === "lyric" ? firstLyric.pairs : [];
check("lyric splits into chord/text pairs", pairs.length === 3, `got ${pairs.length}`);
check("first chord attaches to 'All'", pairs[0]?.chord === "Em" && pairs[0]?.text.startsWith("All"));
check(
  "multi-chord token survives over a syllable",
  pairs[2]?.chord === "C G/B" && pairs[2]?.text.startsWith("mer")
);

// ── 4. Section model + repeat reference ───────────────────────────────────────
const chorusFull = tiog.sections.filter((s) => s.label === "Chorus" && !s.ref);
const chorusRef = tiog.sections.filter((s) => s.label === "Chorus" && s.ref);
check("chorus authored in full exactly once", chorusFull.length === 1);
check("chorus recalled once as a repeat reference", chorusRef.length === 1);
check("a repeat reference carries no lines", chorusRef[0]?.lines.length === 0);
check("section kind classified", chorusFull[0]?.kind === "chorus");
check("verse kind classified", v1?.kind === "verse");

// ── 5. Bar / instrumental notation ────────────────────────────────────────────
const intro = tiog.sections.find((s) => s.label === "Intro");
const barsLine = intro?.lines.find((l) => l.kind === "bars");
const bars = barsLine && barsLine.kind === "bars" ? barsLine.bars : [];
check("bar line splits into bars", bars.length === 2, `got ${bars.length}`);
check("bar tokens split on whitespace", json(bars[0]) === json(["G", "/", "/", "/"]));

// ── 6. Slash + extended chords survive parse→serialize ────────────────────────
const extended = `{section: X}\n[Cmaj7(no3)]a [D(4)]b [C2/E]c [G/B]d`;
check("slash + extended chords round-trip", roundTrips(extended));

// ── 7. Transpose + capo math ──────────────────────────────────────────────────
check("transposeChord slash chord", transposeChord("G/B", 2) === "A/C#", transposeChord("G/B", 2));
check("transposeChord preserves m7 suffix", transposeChord("Em7", 2) === "F#m7");
check("transposeChord preserves (no3) suffix", transposeChord("Cmaj7(no3)", 2) === "Dmaj7(no3)");
check("transposeChord preserves (4) suffix", transposeChord("D(4)", 2) === "E(4)");
check("transposeChord leaves a beat slash alone", transposeChord("/", 5) === "/");
check("keyOfCapo: Bb capo 3 → G shapes", keyOfCapo("Bb", 3) === "G", keyOfCapo("Bb", 3));
check("transposeNote prefers flats when asked", transposeNote("A", 1, true) === "Bb");
check("transposeNote default sharps", transposeNote("A", 1) === "A#");

// ── 8. FTS strip: lyrics in, chords/directives out ────────────────────────────
const text = chordProToText(THIS_IS_OUR_GOD);
check("FTS keeps lyrics", text.includes("Remember those walls"));
check("FTS drops inline chord brackets", !text.includes("["));
check("FTS drops chord names", !text.includes("Gsus") && !text.includes("G/D"));
check("FTS drops directives/meta", !text.includes("Capo") && !text.includes("Bb") && !text.includes("{"));
check("FTS drops repeat-reference (no duplicate chorus)", text.split("This is our God").length - 1 === 1);

// ── 9. HTML render shape ──────────────────────────────────────────────────────
const html = chartToHtml(tiog);
check("renders the meta header line", html.includes("Key: Bb") && html.includes("Capo: 3 (G)"));
check("renders chord cells above text", html.includes('class="cc-chord"') && html.includes('class="cc-text"'));
check("repeat reference renders as a bare label", html.includes("cc-ref"));
check(
  "full chorus rendered once, reference adds no second lyric copy",
  html.split('class="cc-text">This is our ').length - 1 === 1
);
const htmlT2 = chartToHtml(tiog, { transpose: 2 });
check(
  "transposed render shifts chords and key label",
  htmlT2.includes("Key: C") && htmlT2.includes(">D2<"),
  "C2→D2, Bb→C"
);
check("untransposed render keeps the stored key spelling", html.includes("Key: Bb"));

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
