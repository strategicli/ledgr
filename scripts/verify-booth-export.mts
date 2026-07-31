// Verify the booth export (src/lib/editor/booth-export.ts): the sound-booth
// manuscript and its slide list come out of one pass, agreeing on numbering.
//
//   npx tsx scripts/verify-booth-export.mts
import assert from "node:assert/strict";
import { boothExport, slidesMarkdown } from "@/lib/editor/booth-export";

// The slide mark as the editor serializes it (extensions.ts SlideMark).
const S = (text: string) => `<ins class="slide">${text}</ins>`;

// --- slide mark → slide, and the cue that matches it -----------------------
{
  const { manuscript, slides } = boothExport(
    `Turn to <span style="color:#f23a4a">Matthew 6</span>.\n\n` +
      `<ins class="slide">` +
      `<span style="color:#f23a4a">25 Do not be anxious.</span></ins>`
  );
  assert.equal(slides.length, 1);
  assert.equal(slides[0].text, "25 Do not be anxious.", "slide text is flattened");
  assert.match(manuscript, /\*\*\[SLIDE 1\]\*\*/, "manuscript carries the cue");
  assert.ok(!manuscript.includes("<span"), "colors flattened out");
  assert.ok(!manuscript.includes("#f23a4a"), "no color hex survives");
  // The un-highlighted red reference keeps its words, loses its color.
  assert.match(manuscript, /Turn to Matthew 6\./);
}

// --- a HIGHLIGHT is no longer a slide; it is ordinary highlighting ----------
// The slide mark is its own channel now, so all nine highlight colors went back to
// meaning nothing but "I highlighted this."
{
  const md =
    `<mark class="hl-blue" style="background-color:rgba(59,130,246,0.42)">was a slide before</mark>\n\n` +
    `<mark class="hl-yellow" style="background-color:rgba(234,179,8,0.45)">noticed for me</mark>\n\n` +
    `<ins class="slide">on the screen</ins>`;
  const { manuscript, slides } = boothExport(md);
  assert.equal(slides.length, 1, "only the slide mark is a slide");
  assert.equal(slides[0].text, "on the screen");
  // Every highlight keeps its WORDS and loses its markup: the booth copy carries
  // no highlights and no slide tags at all, only the cue.
  assert.match(manuscript, /was a slide before/);
  assert.match(manuscript, /noticed for me/);
  assert.ok(!manuscript.includes("<mark"), "no highlight markup reaches the booth");
  assert.ok(!manuscript.includes("<ins"), "no slide markup reaches the booth");
  assert.equal(manuscript.match(/\[SLIDE \d+\]/g)?.length, 1, "exactly one cue");
  assert.match(manuscript, /\*\*\[SLIDE 1\]\*\* on the screen/);
}
// The mark survives extra attributes and attribute order (a paste path, a future
// data- attribute), since the class is matched inside the tag rather than assumed
// to be the whole of it.
{
  const { slides } = boothExport(
    `<ins data-x="1" class="foo slide">on the screen</ins>`
  );
  assert.equal(slides.length, 1, "class matched among others, attrs in any order");
}
// A plain <ins> that is NOT ours is left alone entirely.
{
  const { slides, manuscript } = boothExport(`<ins>inserted text</ins>`);
  assert.equal(slides.length, 0, "a bare <ins> is not a slide");
  assert.match(manuscript, /inserted text/);
}

// --- a slide layers OVER a text color, in EITHER nesting order --------------
// This is the property the whole design rests on: marking a verse for the screen
// must not cost it its "this is Scripture" color in the preacher's own copy. The
// OUTER case is also the one a span-based mark could not parse (same-tag nesting),
// which is why the tag is <ins> — see extensions.ts.
{
  const outer = boothExport(
    `<ins class="slide"><span style="color:#f23a4a">verse</span></ins>`
  );
  const inner = boothExport(
    `<span style="color:#f23a4a"><ins class="slide">verse</ins></span>`
  );
  assert.equal(outer.slides.length, 1, "slide outside color is a slide");
  assert.equal(inner.slides.length, 1, "color outside slide is a slide");
  assert.equal(outer.slides[0].text, "verse");
  assert.equal(inner.slides[0].text, "verse");
}

// --- bridging: one highlight dragged across blocks is ONE slide -------------
{
  // The editor closes and reopens the mark per block, so this is what a
  // three-bullet highlight actually serializes to.
  const { slides } = boothExport(
    `- ${S("one")}\n- ${S("two")}\n- ${S("three")}`
  );
  assert.equal(slides.length, 1, "adjacent marks bridge into one slide");
  assert.equal(slides[0].text, "one\ntwo\nthree");
}
{
  // Real prose between two highlights means two separate slides.
  const { slides } = boothExport(
    `${S("first")}\n\nHe goes on to say:\n\n${S("second")}`
  );
  assert.equal(slides.length, 2, "prose between highlights breaks the run");
  assert.deepEqual(
    slides.map((s) => s.n),
    [1, 2]
  );
}
{
  // A highlighted (not slid) line between two slides is text neither slide covers,
  // so it breaks the run rather than being swallowed into slide 1.
  const { slides } = boothExport(
    `- ${S("one")}\n- <mark class="hl-yellow">mine</mark>\n- ${S("two")}`
  );
  assert.equal(slides.length, 2, "a highlighted line breaks a bridged run");
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
    `## {==Practice==}{>>needs reworking<<}\n\n<ins class="slide">on screen{>>check this<<}</ins>`
  );
  assert.ok(!manuscript.includes("needs reworking"), "comment note stripped");
  assert.match(manuscript, /## Practice/, "commented text itself survives");
  assert.equal(slides[0].text, "on screen", "slide text carries no note");
}

// --- fenced code is left alone --------------------------------------------
{
  const { slides, manuscript } = boothExport(
    '```\n<ins class="slide">not a slide</ins>\n```'
  );
  assert.equal(slides.length, 0, "a mark inside a fence is literal text");
  assert.match(manuscript, /<ins class="slide">not a slide<\/ins>/);
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
