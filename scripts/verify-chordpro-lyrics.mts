// Song module (v5) verification: pasted-lyrics → sections, chorus de-dup (ref),
// and lyrics→markdown. Pure, no DB. Run: npx tsx scripts/verify-chordpro-lyrics.mts
import { chartToLyricsMarkdown, chartToLyricsText, lyricsToSections, mergeLyricsIntoChart } from "../src/lib/chordpro/lyrics";
import type { ChordChart } from "../src/lib/chordpro/types";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

const lyrics = `VERSE 1
By faith they held the promise
For this world was not their home

CHORUS
They were waiting for heaven
They were living in faith

VERSE 2
I'll lay down every failure
Giving You my life my all

CHORUS
I'm waiting for heaven
But I'm living in faith

BRIDGE
So here I am surrounded
By such a host of saints
[tag]
For the joy set before Him
He endured my cross and shame

CHORUS 2
A genuinely different chorus`;

const sections = lyricsToSections(lyrics);
const labels = sections.map((s) => `${s.label}${s.ref ? "*" : ""}`);
check("section order + refs (labels uppercased)", labels.join(" | ") === "VERSE 1 | CHORUS | VERSE 2 | CHORUS* | BRIDGE | TAG | CHORUS 2", labels.join(" | "));

const verse1 = sections.find((s) => s.label === "VERSE 1")!;
check("verse 1 has its 2 lyric lines", verse1.lines.length === 2 && verse1.lines[0].kind === "lyric");
check("chord-less lyric pair", verse1.lines[0].kind === "lyric" && verse1.lines[0].pairs[0].chord === null);

const choruses = sections.filter((s) => s.label === "CHORUS");
check("first CHORUS has content", choruses[0].lines.length === 2 && !choruses[0].ref);
check("repeated CHORUS is a ref with no lines", choruses[1].ref === true && choruses[1].lines.length === 0);
check("CHORUS 2 is its own content section", sections.find((s) => s.label === "CHORUS 2")?.lines.length === 1);
check("[tag] header detected + uppercased to TAG", sections.find((s) => s.label === "TAG")?.kind === "tag");

// kinds
check("VERSE 1 kind=verse, CHORUS kind=chorus, BRIDGE kind=bridge", verse1.kind === "verse" && choruses[0].kind === "chorus" && sections.find((s) => s.label === "BRIDGE")?.kind === "bridge");

// merge preserves chords on unchanged lines, drops them on edited lines
const withChords: ChordChart = {
  meta: {},
  sections: [
    {
      label: "VERSE 1",
      kind: "verse",
      ref: false,
      lines: [
        { kind: "lyric", pairs: [{ chord: "G", text: "Amazing grace" }] },
        { kind: "lyric", pairs: [{ chord: "C", text: "how sweet the sound" }] },
      ],
    },
  ],
};
const remerged = mergeLyricsIntoChart(withChords, "VERSE 1\nAmazing grace\nhow sweet the SOUND");
const v1 = remerged.sections[0];
check("merge keeps the unchanged line's chord", v1.lines[0].kind === "lyric" && v1.lines[0].pairs[0].chord === "G");
check("merge drops chord on the edited line", v1.lines[1].kind === "lyric" && v1.lines[1].pairs[0].chord === null && v1.lines[1].pairs[0].text === "how sweet the SOUND");

// chartToLyricsText round-trips through lyricsToSections
const text = chartToLyricsText(withChords);
check("chartToLyricsText shows header + words", text.includes("VERSE 1") && text.includes("Amazing grace"));
check("round-trips to one section, 2 lines", lyricsToSections(text).length === 1 && lyricsToSections(text)[0].lines.length === 2);

// lyrics markdown expands the ref chorus to the original's words
const md = chartToLyricsMarkdown({ meta: { title: "Waiting for Heaven" }, sections });
check("markdown has title + section headers", md.startsWith("# Waiting for Heaven") && md.includes("## VERSE 1") && md.includes("## CHORUS"));
check("ref chorus expands to the first chorus words", (md.match(/They were waiting for heaven/g)?.length ?? 0) === 2);
check("CHORUS 2 distinct words present", md.includes("A genuinely different chorus"));

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
