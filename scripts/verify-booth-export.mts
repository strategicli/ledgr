// Verify the booth export (src/lib/editor/booth-export.ts): the sound-booth
// manuscript and its slide list come out of one pass, agreeing on numbering.
//
//   npx tsx scripts/verify-booth-export.mts
import assert from "node:assert/strict";
import { boothExport, slidesMarkdown } from "@/lib/editor/booth-export";

// --- BLUE highlight → slide, and the cue that matches it -------------------
{
  const { manuscript, slides } = boothExport(
    `Turn to <span style="color:#f23a4a">Matthew 6</span>.\n\n` +
      `<mark class="hl-blue" style="background-color:rgba(59,130,246,0.42)">` +
      `<span style="color:#f23a4a">25 Do not be anxious.</span></mark>`
  );
  assert.equal(slides.length, 1);
  assert.equal(slides[0].text, "25 Do not be anxious.", "slide text is flattened");
  assert.match(manuscript, /\*\*\[SLIDE 1\]\*\*/, "manuscript carries the cue");
  assert.ok(!manuscript.includes("<span"), "colors flattened out");
  assert.ok(!manuscript.includes("#f23a4a"), "no color hex survives");
  // The un-highlighted red reference keeps its words, loses its color.
  assert.match(manuscript, /Turn to Matthew 6\./);
}

// --- ONLY blue is a slide; every other highlight just flattens away ---------
{
  const md =
    `<mark class="hl-yellow" style="background-color:rgba(234,179,8,0.45)">noticed for me</mark>\n\n` +
    `<mark class="hl-blue" style="background-color:rgba(59,130,246,0.42)">on the screen</mark>\n\n` +
    `<mark>a bare mark</mark>`;
  const { manuscript, slides } = boothExport(md);
  assert.equal(slides.length, 1, "only the blue highlight is a slide");
  assert.equal(slides[0].text, "on the screen");
  // The non-slide highlights keep their WORDS and lose their markup — the booth
  // copy carries no highlights at all.
  assert.match(manuscript, /noticed for me/);
  assert.match(manuscript, /a bare mark/);
  assert.ok(!manuscript.includes("<mark"), "no highlight markup reaches the booth");
  assert.ok(!manuscript.includes("hl-yellow"));
  // Exactly one cue, on the blue one.
  assert.equal(manuscript.match(/\[SLIDE \d+\]/g)?.length, 1);
  assert.match(manuscript, /\*\*\[SLIDE 1\]\*\* on the screen/);
}
// The color may arrive as a background style with the class stripped (colors.ts
// keeps that fallback), and it still counts.
{
  const { slides } = boothExport(
    `<mark style="background-color:rgba(59,130,246,0.42)">on the screen</mark>`
  );
  assert.equal(slides.length, 1, "blue by background value, class stripped");
}

// --- a highlight layers OVER a text color, in EITHER nesting order ----------
// This is the property the whole design rests on: marking a verse for the screen
// must not cost it its "this is Scripture" color in the preacher's own copy.
{
  const outer = boothExport(
    `<mark class="hl-blue"><span style="color:#f23a4a">verse</span></mark>`
  );
  const inner = boothExport(
    `<span style="color:#f23a4a"><mark class="hl-blue">verse</mark></span>`
  );
  assert.equal(outer.slides.length, 1, "highlight outside color is a slide");
  assert.equal(inner.slides.length, 1, "color outside highlight is a slide");
  assert.equal(outer.slides[0].text, "verse");
  assert.equal(inner.slides[0].text, "verse");
}

// --- bridging: one highlight dragged across blocks is ONE slide -------------
{
  // The editor closes and reopens the mark per block, so this is what a
  // three-bullet highlight actually serializes to.
  const { slides } = boothExport(
    `- <mark class="hl-blue">one</mark>\n- <mark class="hl-blue">two</mark>\n- <mark class="hl-blue">three</mark>`
  );
  assert.equal(slides.length, 1, "adjacent marks bridge into one slide");
  assert.equal(slides[0].text, "one\ntwo\nthree");
}
{
  // Real prose between two highlights means two separate slides.
  const { slides } = boothExport(
    `<mark class="hl-blue">first</mark>\n\nHe goes on to say:\n\n<mark class="hl-blue">second</mark>`
  );
  assert.equal(slides.length, 2, "prose between highlights breaks the run");
  assert.deepEqual(
    slides.map((s) => s.n),
    [1, 2]
  );
}
{
  // A highlight in another color between two blue ones is not part of either
  // slide, so it breaks the run rather than being swallowed into slide 1.
  const { slides } = boothExport(
    `- <mark class="hl-blue">one</mark>\n- <mark class="hl-yellow">mine</mark>\n- <mark class="hl-blue">two</mark>`
  );
  assert.equal(slides.length, 2, "a non-blue highlight breaks a bridged run");
  assert.equal(slides[0].text, "one");
  assert.equal(slides[1].text, "two");
}

// --- struck-through material leaves entirely; ++underline++ unwraps ---------
{
  const { manuscript } = boothExport(
    `- <span style="color:#4ade80">~~ILLUSTRATION: does whining work?~~</span>\n` +
      `- **++How long will my life be?++**\n` +
      `- kept`
  );
  assert.ok(!manuscript.includes("whining"), "cut material is gone");
  assert.ok(
    !/^- *$/m.test(manuscript),
    "no empty bullet left where the cut line was"
  );
  assert.match(manuscript, /\*\*How long will my life be\?\*\*/, "++ unwrapped, bold kept");
  assert.ok(!manuscript.includes("++"), "no literal plus signs reach the booth");
  assert.match(manuscript, /- kept/);
}

// --- an untouched line is never dropped ------------------------------------
{
  const { manuscript } = boothExport(`# Intro\n\n---\n\ntext`);
  assert.match(manuscript, /^---$/m, "a horizontal rule survives");
  assert.match(manuscript, /^# Intro$/m, "headings survive");
}

// --- private notes to self never reach the booth ---------------------------
{
  const { manuscript, slides } = boothExport(
    `## {==Practice==}{>>needs reworking<<}\n\n<mark class="hl-blue">on screen{>>check this<<}</mark>`
  );
  assert.ok(!manuscript.includes("needs reworking"), "comment note stripped");
  assert.match(manuscript, /## Practice/, "commented text itself survives");
  assert.equal(slides[0].text, "on screen", "slide text carries no note");
}

// --- fenced code is left alone --------------------------------------------
{
  const { slides, manuscript } = boothExport(
    '```\n<mark class="hl-blue">not a slide</mark>\n```'
  );
  assert.equal(slides.length, 0, "a mark inside a fence is literal text");
  assert.match(manuscript, /<mark class="hl-blue">not a slide<\/mark>/);
}

// --- empty in, empty out --------------------------------------------------
{
  const { manuscript, slides } = boothExport("");
  assert.equal(manuscript, "");
  assert.equal(slides.length, 0);
}

// --- the slides document ---------------------------------------------------
{
  const md = slidesMarkdown([
    { n: 1, text: "25 Do not be anxious." },
    { n: 2, text: "Only do what He's given you to do." },
  ]);
  assert.match(md, /## Slide 1\n\n25 Do not be anxious\./);
  assert.match(md, /## Slide 2\n\nOnly do what He's given you to do\./);
}

console.log("booth export ✓");
