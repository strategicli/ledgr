// Verify the live-follow state validator (src/modules/presentations/lib/live-state.ts).
// DB-free by design (must not import @/db). Run with `npx tsx`.
import assert from "node:assert/strict";
import { parseLiveState } from "../src/modules/presentations/lib/live-state";

// valid, passes through
assert.deepEqual(
  parseLiveState({ i: 2, step: 1, blank: "black", countdownEnd: 123, build: true }),
  { i: 2, step: 1, blank: "black", countdownEnd: 123, build: true }
);

// clamps negatives and floats, defaults build to false when not exactly true
assert.deepEqual(
  parseLiveState({ i: -3, step: 1.9, blank: "", countdownEnd: null, build: "yes" }),
  { i: 0, step: 1, blank: "", countdownEnd: null, build: false }
);

// rejects a bad blank value
assert.equal(parseLiveState({ i: 0, step: 0, blank: "purple", countdownEnd: null }), null);

// rejects missing/non-numeric fields
assert.equal(parseLiveState({ i: "0", step: 0, blank: "", countdownEnd: null }), null);
assert.equal(parseLiveState(null), null);
assert.equal(parseLiveState("state"), null);
assert.equal(parseLiveState({}), null);

console.log("verify-presentation-live: ok");
