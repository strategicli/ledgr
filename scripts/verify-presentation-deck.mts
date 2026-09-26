// Verify the presentations deck parser (src/modules/presentations/lib/deck.ts).
//
//   npx tsx scripts/verify-presentation-deck.mts
import assert from "node:assert/strict";
import { buildDeck, chordProToSlides, soleMention } from "@/modules/presentations/lib/deck";
import { parseChordPro } from "@/lib/chordpro/parse";

// --- manuscript mode: slide marks are slides, prose between cues is notes ---
{
  const d = buildDeck(
    "Welcome, open to Matthew.\n\n<ins class=\"slide\">Do not worry.</ins> Say it slowly.\n\n" +
      "Next thought.\n\n<ins class=\"slide\"><span style=\"color:#f23a4a\">Seek first.</span></ins> Pause.",
    "Don't Worry"
  );
  assert.equal(d.mode, "manuscript");
  assert.equal(d.slides.length, 3, "title slide + two marks");
  assert.equal(d.slides[0].md, "# Don't Worry");
  assert.match(d.slides[0].notes, /Welcome, open to Matthew/);
  assert.equal(d.slides[1].md, "Do not worry.");
  assert.match(d.slides[1].notes, /Say it slowly[\s\S]*Next thought/);
  assert.ok(!d.slides[1].notes.includes("[SLIDE"), "cues never reach notes");
  assert.equal(d.slides[2].md, "Seek first.", "colors flattened");
}

// --- deck mode: --- after a blank line breaks; comments become notes -------
{
  const d = buildDeck("# One\n\nHello {>>smile<<}\n\n---\n\n## Two\n\n- a\n- b");
  assert.equal(d.mode, "deck");
  assert.equal(d.slides.length, 2);
  assert.equal(d.slides[0].md, "# One\n\nHello");
  assert.equal(d.slides[0].notes, "smile");
  assert.equal(d.slides[1].md, "## Two\n\n- a\n- b");
}

// --- a setext heading underline is NOT a break ---------------------------
{
  const d = buildDeck("Title\n---\n\nbody");
  assert.equal(d.slides.length, 1);
}

// --- no rules: headings split, and a fenced --- is ignored ----------------
{
  const d = buildDeck("# A\n\ntext\n\n```\n\n---\n# not a heading\n```\n\n## B\n\nmore");
  assert.equal(d.slides.length, 2);
  assert.match(d.slides[0].md, /not a heading/);
  assert.equal(d.slides[1].md, "## B\n\nmore");
}

// --- empty body still yields one slide -----------------------------------
assert.equal(buildDeck("", "T").slides[0].md, "# T");

// --- sole mention -------------------------------------------------------
const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
assert.equal(soleMention(`[@Amazing Grace](ledgr://item/${ID})`), ID);
assert.equal(soleMention(`See [@Amazing Grace](ledgr://item/${ID})`), null);

// --- chordpro embed (step 5): one slide per section, chords stripped, empty skipped
{
  const chart = parseChordPro(
    "{title: Amazing Grace}\n" +
      "{start_of_verse}\n[G]Amazing [C]grace, how [G]sweet the sound\n{end_of_verse}\n" +
      "{start_of_chorus}\n[G]My chains are [C]gone\n{end_of_chorus}\n" +
      "{section: Bridge}\n{repeat: Chorus}\n" +
      "{section: Outro}\n"
  );
  const slides = chordProToSlides(chart);
  assert.equal(slides.length, 3, "verse + chorus + repeated bridge; empty outro skipped");
  assert.equal(slides[0].md, "Amazing grace, how sweet the sound");
  assert.ok(!slides[0].md.includes("["), "chords stripped");
  assert.equal(slides[1].md, "My chains are gone");
  assert.equal(slides[2].md, "My chains are gone", "ref section recalls the original's lines");
}

console.log("verify-presentation-deck: ok");
