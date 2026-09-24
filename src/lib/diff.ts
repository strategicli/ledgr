// Word-level text diff for the version-history "Show changes" view (Track
// changes chunk). Pure + client-safe + no dependency (Principle 5): a hand-
// rolled LCS over word tokens, the same shape git/GitHub use for prose. Bodies
// are markdown text (the canonical { format, text }, ADR-037), so the diff is
// over the markdown source — honest about exactly what changed, no DOM diffing.
//
// Strategy: two tiers, the git/GitHub shape. A line-level LCS runs first so
// unchanged paragraphs anchor as eq wherever the edits sit (prefix/suffix
// trimming alone dies the moment a doc has edits near both ends); each changed
// line region then gets a word-level LCS of its own, so every word table stays
// tiny. A size guard falls back to a coarse delete-all + add-all when a region
// is pathologically large, so a huge rewrite can never hang the UI.

export type DiffOp = "eq" | "add" | "del";
export type DiffSegment = { op: DiffOp; text: string };

// Tokenize into words (maximal non-space runs), horizontal-whitespace runs, and
// individual newlines. Keeping whitespace and newlines as their own tokens
// preserves spacing/structure in the rendered diff and lets an added/removed
// line break show up as its own change. Concatenating all tokens reproduces the
// input exactly (the regex partitions the string with no gaps).
export function tokenizeWords(text: string): string[] {
  return text.match(/\n|[^\S\n]+|[^\s]+/g) ?? [];
}

// Tokenize into lines, each keeping its trailing newline so concatenating the
// tokens reproduces the input exactly (a final line without a newline is its
// own token).
function tokenizeLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

// Above this token-product the middle LCS is skipped for a coarse whole-region
// replace. ~1.5M cells of Int32 ≈ 6MB worst case; real adjacent-revision diffs
// fall far under it after prefix/suffix trimming.
const LCS_CELL_CAP = 1_500_000;

// Merge consecutive same-op segments into one run, dropping empties. Rendering
// wants "a removed sentence" as one node, not one node per token.
function coalesce(segments: DiffSegment[]): DiffSegment[] {
  const out: DiffSegment[] = [];
  for (const seg of segments) {
    if (seg.text === "") continue;
    const last = out[out.length - 1];
    if (last && last.op === seg.op) last.text += seg.text;
    else out.push({ op: seg.op, text: seg.text });
  }
  return out;
}

// LCS diff over two token arrays (already prefix/suffix-trimmed by diffWords).
// Returns token-level ops in reading order; diffWords coalesces them.
function lcsDiff(a: string[], b: string[]): DiffSegment[] {
  const m = a.length;
  const n = b.length;
  if (m === 0 && n === 0) return [];
  if (m === 0) return [{ op: "add", text: b.join("") }];
  if (n === 0) return [{ op: "del", text: a.join("") }];
  // Pathological middle: don't build a giant table, just show it as a full
  // replace. Rare in practice (a near-total rewrite between two snapshots).
  if (m * n > LCS_CELL_CAP) {
    return [
      { op: "del", text: a.join("") },
      { op: "add", text: b.join("") },
    ];
  }

  // dp[i*(n+1)+j] = LCS length of a[i:] vs b[j:]. Filled bottom-up so the
  // forward walk below can pick the move that preserves the longest match.
  const width = n + 1;
  const dp = new Int32Array((m + 1) * width);
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i * width + j] =
        a[i] === b[j]
          ? dp[(i + 1) * width + (j + 1)] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + (j + 1)]);
    }
  }

  const segs: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      segs.push({ op: "eq", text: a[i] });
      i++;
      j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) {
      segs.push({ op: "del", text: a[i] });
      i++;
    } else {
      segs.push({ op: "add", text: b[j] });
      j++;
    }
  }
  while (i < m) segs.push({ op: "del", text: a[i++] });
  while (j < n) segs.push({ op: "add", text: b[j++] });
  return segs;
}

// Trim the common prefix and suffix off two token arrays, LCS the middle.
// Works for any token granularity (lines above, words within a region).
function trimmedLcsDiff(at: string[], bt: string[]): DiffSegment[] {
  // Common prefix.
  let start = 0;
  const minLen = Math.min(at.length, bt.length);
  while (start < minLen && at[start] === bt[start]) start++;

  // Common suffix (not overlapping the prefix).
  let aEnd = at.length;
  let bEnd = bt.length;
  while (aEnd > start && bEnd > start && at[aEnd - 1] === bt[bEnd - 1]) {
    aEnd--;
    bEnd--;
  }

  const out: DiffSegment[] = [];
  if (start > 0) out.push({ op: "eq", text: at.slice(0, start).join("") });
  out.push(...lcsDiff(at.slice(start, aEnd), bt.slice(start, bEnd)));
  if (aEnd < at.length) out.push({ op: "eq", text: at.slice(aEnd).join("") });
  return out;
}

// Diff two markdown strings into ordered eq/add/del segments. `a` is the older
// text, `b` the newer; an "add" is in b-not-a, a "del" is in a-not-b.
export function diffWords(a: string, b: string): DiffSegment[] {
  if (a === b) return a === "" ? [] : [{ op: "eq", text: a }];

  // Tier 1: line-level. Unchanged lines anchor as eq no matter where the
  // edits are, so each changed region handed to tier 2 stays small.
  const lineOps = trimmedLcsDiff(tokenizeLines(a), tokenizeLines(b));

  // Walk the line ops, buffering each contiguous changed region (its deleted
  // and added lines) and word-diffing the pair; one-sided regions pass through
  // as-is.
  const out: DiffSegment[] = [];
  let delBuf = "";
  let addBuf = "";
  const flush = () => {
    if (delBuf !== "" && addBuf !== "") {
      out.push(...trimmedLcsDiff(tokenizeWords(delBuf), tokenizeWords(addBuf)));
    } else if (delBuf !== "") {
      out.push({ op: "del", text: delBuf });
    } else if (addBuf !== "") {
      out.push({ op: "add", text: addBuf });
    }
    delBuf = "";
    addBuf = "";
  };
  for (const seg of lineOps) {
    if (seg.op === "eq") {
      flush();
      out.push(seg);
    } else if (seg.op === "del") {
      delBuf += seg.text;
    } else {
      addBuf += seg.text;
    }
  }
  flush();
  return coalesce(out);
}

// A changed region of `base`: lines [start, end) replaced by `text`. An insert
// is an empty range (start === end).
type Hunk = { start: number; end: number; text: string };

function lineHunks(baseLines: string[], other: string): Hunk[] {
  const hunks: Hunk[] = [];
  let at = 0;
  let open: Hunk | null = null;
  for (const seg of trimmedLcsDiff(baseLines, tokenizeLines(other))) {
    // Segments from lcsDiff are per-line, but the trimmed prefix/suffix and the
    // coarse fallback arrive as joined runs, so count lines rather than segments.
    const n = seg.op === "add" ? 0 : tokenizeLines(seg.text).length;
    if (seg.op === "eq") {
      open = null;
      at += n;
      continue;
    }
    if (!open) hunks.push((open = { start: at, end: at, text: "" }));
    if (seg.op === "del") open.end = at += n;
    else open.text += seg.text;
  }
  return hunks;
}

// Three-way line merge for a live editor (Feature 0): `mine` and `theirs` both
// started from `base`. Non-overlapping edits merge cleanly; two edits touching
// the same line (or inserting at the same spot) are a conflict, and the caller
// keeps `mine` and asks. Markdown paragraphs are single lines, so "the same
// line" means "the same paragraph", which is the granularity a person notices.
export function merge3(
  base: string,
  mine: string,
  theirs: string
): { ok: true; text: string } | { ok: false } {
  if (mine === base || mine === theirs) return { ok: true, text: theirs };
  if (theirs === base) return { ok: true, text: mine };
  const baseLines = tokenizeLines(base);
  const a = lineHunks(baseLines, mine);
  const b = lineHunks(baseLines, theirs);
  for (const x of a)
    for (const y of b) {
      const touch =
        x.start < y.end && y.start < x.end ||
        x.start === y.start ||
        (x.start === x.end && x.start > y.start && x.start < y.end) ||
        (y.start === y.end && y.start > x.start && y.start < x.end);
      if (touch) return { ok: false };
    }
  const all = [...a, ...b].sort((p, q) => q.start - p.start);
  const out = [...baseLines];
  for (const h of all) out.splice(h.start, h.end - h.start, h.text);
  return { ok: true, text: out.join("") };
}

// A short "+N −M words" summary for a diff. Counts word tokens (non-whitespace)
// in add/del segments, so reordered whitespace alone reads as no change.
export function diffStats(segments: DiffSegment[]): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const seg of segments) {
    if (seg.op === "eq") continue;
    const words = (seg.text.match(/[^\s]+/g) ?? []).length;
    if (seg.op === "add") added += words;
    else removed += words;
  }
  return { added, removed };
}
