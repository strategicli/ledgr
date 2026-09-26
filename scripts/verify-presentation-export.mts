// Verify the export helpers (ProPresenter text + the pptx md->blocks mapper).
// Both are pure — no DB import — so they run in plain node.
//
//   npx tsx scripts/verify-presentation-export.mts
import assert from "node:assert/strict";
import { deckToProPresenterText } from "../src/modules/presentations/lib/propresenter";
import { slideToBlocks, isImageOnlySlide } from "../src/modules/presentations/lib/slide-blocks";

// --- deckToProPresenterText --------------------------------------------------

// A heading + a paragraph become one block, joined by a real newline, no
// internal blank line even though the source has one.
assert.equal(
  deckToProPresenterText([{ md: "# Welcome\n\nGlad you're here." }]),
  "Welcome\nGlad you're here."
);

// Two slides -> two blocks separated by exactly one blank line.
assert.equal(
  deckToProPresenterText([{ md: "# One" }, { md: "# Two" }]),
  "One\n\nTwo"
);

// List markers, blockquote markers, emphasis and links strip to plain text.
assert.equal(
  deckToProPresenterText([{ md: "- first\n- second\n> a quote\n**bold** and _em_ and [link](https://x)" }]),
  "first\nsecond\na quote\nbold and em and link"
);

// An image-only slide contributes nothing.
assert.equal(deckToProPresenterText([{ md: "![alt](/files/x)" }]), "");
// An empty/blank slide contributes nothing either.
assert.equal(deckToProPresenterText([{ md: "" }, { md: "# Real" }]), "Real");
// A code fence line is dropped, not left as literal backticks.
assert.equal(deckToProPresenterText([{ md: "```\ncode\n```\nafter" }]), "code\nafter");

// --- slideToBlocks / isImageOnlySlide ---------------------------------------

const heading = slideToBlocks("# Title\nSome body text.");
assert.deepEqual(heading[0], { kind: "heading", text: "Title" });
assert.deepEqual(heading[1], { kind: "paragraph", text: "Some body text." });

const bullets = slideToBlocks("- one\n- two\n- three");
assert.deepEqual(bullets, [{ kind: "bullets", items: ["one", "two", "three"] }]);

const quote = slideToBlocks("> a wise saying\n> continued");
assert.deepEqual(quote, [{ kind: "quote", text: "a wise saying continued" }]);

const imageOnly = slideToBlocks("![a photo](/files/abc)");
assert.deepEqual(imageOnly, [{ kind: "image", src: "/files/abc" }]);
assert.ok(isImageOnlySlide(imageOnly));
assert.ok(!isImageOnlySlide(heading));

// Emphasis and links strip inside every block kind (no `#` marker -> paragraph).
assert.deepEqual(slideToBlocks("**Bold heading**"), [{ kind: "paragraph", text: "Bold heading" }]);
assert.deepEqual(slideToBlocks("- [a link](https://x) item"), [
  { kind: "bullets", items: ["a link item"] },
]);

console.log("verify-presentation-export: ok");
