// One-time (re-runnable) build of src/data/synonyms.json from Princeton WordNet.
// DEV-ONLY: this never runs in production, and WordNet is not a dependency of the
// app — the committed JSON is. Run it when you want to regenerate or re-tune the
// pruning:
//
//   npx tsx scripts/build-synonyms.mts
//
// It downloads the WordNet 3.1 database to a temp dir, extracts a
// lemma -> [synonyms] map, prunes it, and writes the JSON. Deliberately no npm
// package (not even a dev one): the data files are plain text and the parse is a
// few dozen lines (Principle 5).
//
// WordNet is distributed by Princeton University under a permissive BSD-style
// license: free to use, copy, modify, and distribute, including commercially,
// provided the copyright notice appears in all copies. The notice travels in the
// generated file's `_license` field, which is why that key exists.
//   WordNet 3.1 Copyright 2011 by Princeton University. All rights reserved.
//   https://wordnet.princeton.edu/license-and-commercial-use
//
// Why the pruning matters as much as the parse: WordNet has no idea which *sense*
// of a word you meant, so an unpruned map makes "lesson" offer the synonyms of
// "moral of the story" alongside those of "instruction". We keep only each word's
// most common senses (WordNet's index files list senses most-frequent-first),
// which is the single biggest noise lever. The rest of the disambiguation is the
// search's own job: the owner types several words and the shared sense wins on
// score. See src/lib/synonyms.ts.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const WORDNET_URL = "https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data", "synonyms.json");

// --- Pruning knobs. Tuned for signal over coverage; re-run after changing. ----
// Senses kept per word, most-frequent-first. 3 keeps the readings you'd actually
// mean and drops the long tail of obscure ones.
const MAX_SENSES = 3;
// Synonyms kept per word. A search with more than a handful of alternates per
// term stops narrowing anything.
const MAX_SYNONYMS = 8;
// A synset with more members than this is a loose grab-bag, not a synonym set.
const MAX_SYNSET_SIZE = 12;
// Single lowercase words only, 3+ chars. Multi-word entries ("moral_of_the_story")
// can't match a single typed term, and 1-2 char words are noise in FTS anyway.
const WORD_RE = /^[a-z]{3,}$/;

const POS_FILES = ["noun", "verb", "adj", "adv"] as const;

function download(dir: string): string {
  const tar = join(dir, "wn.tar.gz");
  console.log(`Downloading ${WORDNET_URL} …`);
  execFileSync("curl", ["-sSL", "--max-time", "300", "-o", tar, WORDNET_URL]);
  execFileSync("tar", ["xzf", tar, "-C", dir]);
  return join(dir, "dict");
}

// A data.<pos> line:
//   offset lex_filenum ss_type w_cnt word lex_id [word lex_id ...] p_cnt … | gloss
// w_cnt is 2-digit HEX. Adjective members can carry a syntactic marker —
// "word(a)", "word(p)", "word(ip)" — which is stripped. License header lines
// start with a space, so they're skipped.
function parseSynsets(dict: string, pos: string): Map<string, string[]> {
  const byOffset = new Map<string, string[]>();
  for (const line of readFileSync(join(dict, `data.${pos}`), "latin1").split("\n")) {
    if (!line || line.startsWith(" ")) continue;
    const fields = line.split(" | ")[0].split(" ");
    const offset = fields[0];
    const wordCount = parseInt(fields[3], 16);
    if (!Number.isFinite(wordCount) || wordCount < 1) continue;
    const words: string[] = [];
    // Members start at field 4 as (word, lex_id) pairs.
    for (let i = 0; i < wordCount; i++) {
      const raw = fields[4 + i * 2];
      if (!raw) break;
      const word = raw.replace(/\(\w+\)$/, "").toLowerCase();
      if (WORD_RE.test(word)) words.push(word);
    }
    if (words.length > 1 && words.length <= MAX_SYNSET_SIZE) byOffset.set(offset, words);
  }
  return byOffset;
}

// An index.<pos> line:
//   lemma pos synset_cnt p_cnt [ptr_symbol…] sense_cnt tagsense_cnt offset [offset…]
// The offsets are the LAST synset_cnt fields (the pointer-symbol list in the
// middle is variable-length), and they are ordered most-frequent-sense first.
function parseIndex(dict: string, pos: string): Map<string, string[]> {
  const senses = new Map<string, string[]>();
  for (const line of readFileSync(join(dict, `index.${pos}`), "latin1").split("\n")) {
    if (!line || line.startsWith(" ")) continue;
    const fields = line.trim().split(/\s+/);
    const lemma = fields[0].toLowerCase();
    if (!WORD_RE.test(lemma)) continue;
    const synsetCount = Number(fields[2]);
    if (!Number.isFinite(synsetCount) || synsetCount < 1) continue;
    senses.set(lemma, fields.slice(fields.length - synsetCount).slice(0, MAX_SENSES));
  }
  return senses;
}

const tmp = mkdtempSync(join(tmpdir(), "wordnet-"));
try {
  const dict = download(tmp);

  // lemma -> ordered synonyms, unioned across parts of speech. A word that is
  // both a noun and a verb ("teaching") contributes both, nouns first.
  const merged = new Map<string, string[]>();
  for (const pos of POS_FILES) {
    const synsets = parseSynsets(dict, pos);
    const index = parseIndex(dict, pos);
    console.log(`  ${pos}: ${synsets.size} usable synsets, ${index.size} lemmas`);
    for (const [lemma, offsets] of index) {
      const out = merged.get(lemma) ?? [];
      for (const offset of offsets) {
        for (const word of synsets.get(offset) ?? []) {
          if (word !== lemma && !out.includes(word)) out.push(word);
        }
      }
      if (out.length > 0) merged.set(lemma, out);
    }
  }

  const entries = [...merged.entries()]
    .map(([lemma, syns]) => [lemma, syns.slice(0, MAX_SYNONYMS)] as const)
    .filter(([, syns]) => syns.length > 0)
    .sort(([a], [b]) => (a < b ? -1 : 1));

  const payload: Record<string, string[] | string> = {
    _license:
      "WordNet 3.1 Copyright 2011 by Princeton University. All rights reserved. " +
      "Used under the WordNet license: https://wordnet.princeton.edu/license-and-commercial-use",
  };
  for (const [lemma, syns] of entries) payload[lemma] = syns;

  mkdirSync(dirname(OUT), { recursive: true });
  const json = JSON.stringify(payload);
  writeFileSync(OUT, json);

  const totalSyns = entries.reduce((n, [, s]) => n + s.length, 0);
  console.log(
    `\nWrote ${OUT}\n  ${entries.length} words, ${totalSyns} synonyms ` +
      `(avg ${(totalSyns / entries.length).toFixed(1)}), ${(json.length / 1024 / 1024).toFixed(2)} MB`
  );
  for (const probe of ["teaching", "sermon", "lesson", "meeting", "budget"]) {
    console.log(`  ${probe} -> ${(merged.get(probe) ?? []).slice(0, MAX_SYNONYMS).join(", ") || "(none)"}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
