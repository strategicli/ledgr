// Verify the presentation design contract (src/modules/presentations/lib/design.ts).
//
//   npx tsx scripts/verify-presentation-design.mts
import assert from "node:assert/strict";
import { DEFAULT_DESIGN, designColors, inSlideList, parseDesign } from "@/modules/presentations/lib/design";

// junk in → defaults out
assert.deepEqual(parseDesign(null), DEFAULT_DESIGN);
assert.deepEqual(parseDesign({ theme: "neon", logo: "x", transition: { effect: "swirl" } }), DEFAULT_DESIGN);

// valid values survive, invalid ones are dropped or clamped
const d = parseDesign({
  theme: "sepia",
  textColor: "#112233",
  headingColor: "red",
  logo: { src: "/files/0f8fad5b-d9cb-469f-a165-70867728950e", corner: "tl", size: "l" },
  background: { image: "https://evil.example/x.png", darken: 150 },
  titleBar: { enabled: true, text: "Series", position: "bottom" },
  transition: { effect: "wipe-up", speed: "slow" },
});
assert.equal(d.theme, "sepia");
assert.equal(d.textColor, "#112233");
assert.equal(d.headingColor, null, "non-hex color rejected");
assert.equal(d.logo.corner, "tl");
assert.equal(d.background.image, null, "outside image address rejected");
assert.equal(d.background.darken, 90, "darken clamped");
assert.equal(d.titleBar.position, "bottom");
assert.equal(d.transition.effect, "wipe-up");

// an explicit null clears a base value; a missing key keeps it
const base = parseDesign({ logo: { src: "/files/0f8fad5b-d9cb-469f-a165-70867728950e" } });
assert.equal(parseDesign({ logo: { src: null } }, base).logo.src, null);
assert.equal(parseDesign({ theme: "light" }, base).logo.src, base.logo.src);

// colors fall back to the theme
assert.equal(designColors(parseDesign({ theme: "light" })).bg, "#ffffff");
assert.equal(designColors(d).text, "#112233");

// slide lists
assert.ok(inSlideList("1, 5-7", 1));
assert.ok(inSlideList("1, 5-7", 6));
assert.ok(!inSlideList("1, 5-7", 4));
assert.ok(!inSlideList("", 1));
assert.ok(inSlideList("junk, 3", 3));

console.log("verify-presentation-design: ok");
