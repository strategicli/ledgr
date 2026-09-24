// Verifies the three-way line merge that lets an open editor take a change made
// elsewhere without dropping the owner's unsaved typing (Feature 0 of the
// in-app agent). Pure; no DB.
//
//   npx tsx scripts/verify-merge3.mts
import { merge3 } from "../src/lib/diff";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS  ${name}`);
  else {
    failures++;
    console.log(`FAIL  ${name}${detail === undefined ? "" : `  (${JSON.stringify(detail)})`}`);
  }
}

const base = "# Title\n\nOne.\n\nTwo.\n\nThree.\n";

let r = merge3(base, base.replace("One.", "One, edited by me."), base.replace("Three.", "Three, edited by Claude."));
check("non-overlapping edits merge", r.ok && r.text === "# Title\n\nOne, edited by me.\n\nTwo.\n\nThree, edited by Claude.\n", r);

r = merge3(base, base.replace("Two.", "Two mine."), base.replace("Two.", "Two theirs."));
check("same paragraph conflicts", !r.ok);

r = merge3(base, base, base.replace("Two.", "Two theirs."));
check("clean mine takes theirs", r.ok && r.text === base.replace("Two.", "Two theirs."));

r = merge3(base, base.replace("Two.", "Two mine."), base);
check("unchanged theirs keeps mine", r.ok && r.text === base.replace("Two.", "Two mine."));

r = merge3(base, base + "\nFour mine.\n", "Zero.\n\n" + base);
check("insert at both ends merges", r.ok && r.text === "Zero.\n\n" + base + "\nFour mine.\n", r);

r = merge3(base, base + "Four mine.\n", base + "Four theirs.\n");
check("insert at the same spot conflicts", !r.ok);

r = merge3(base, base.replace("One.", "One mine."), base.replace("One.\n\nTwo.", "Merged by Claude."));
check("edit inside a replaced range conflicts", !r.ok);

r = merge3("a\nb\nc", "a\nb\nc!", "A\nb\nc");
check("no trailing newline still merges", r.ok && r.text === "A\nb\nc!", r);

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall merge3 checks passed");
