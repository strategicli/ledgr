# Module: Songs

**Status:** Draft v0.1
**Builds on:** PRD §3.6/§3.7, §4.13 (canvas)
**Canonical body format:** ChordPro (markdown-kin: plain text + lightweight inline markup)
**Priority:** 3rd module — high value, no active deadline

---

## What it's for

Worship songwriting. Today this is scattered across Google Docs (lyrics/charts), Apple Notes (fragments on the phone), and Suno (rapid sonic prototypes). The pain: writing chord charts in Word/Docs is slow, **moving chords around when reordering is painful**, and the same chart gets rewritten again in Planning Center later. The module fixes all three by storing a song as **structured data, not text with chords typed above it.**

The standalone chord-chart app Tyler considered building **should not be standalone** — it's the Songs canvas inside Ledgr, so song data lands in the linked brain (songs ↔ passages ↔ progressions ↔ services) instead of another silo.

## Why structure wins (the whole argument)

Store a song as sections → lines → lyric+chord attachments, and the pain points become trivial functions over data:

- **Transpose** = pure function; any key, capo charts, one click.
- **Nashville numbers** = a render mode, not a rewrite.
- **Reorder chords / sections** = drag-and-drop, not multi-line surgery.
- **Render** to clean chart / team PDF / PCO format = exporters off one source.

**ChordPro** is the canonical interchange format (square-bracket chords inline with lyrics). Planning Center's chart syntax is close kin, so building the internal model to round-trip ChordPro gives portability beyond PCO too.

## Entities & shape

**`song`** (system type, ChordPro-canonical body):
- `title`, `body` (ChordPro source)
- properties: `key`, `mode` (e.g. "G Mixolydian"), `tempo`, `time_signature`, `ccli`, `stage` (spark → developing → drafting → done → delivered), `theme`
- relations: → `passage` entities (the Scripture the song is grounded in — e.g. "Better" → Hebrews), → `progression` items used, → Suno links (as `link` items), → `service`/event entities when scheduled

**`progression`** (system sub-type — the sleeper feature):
- Stored in **Roman/Nashville form** so they're key-agnostic.
- fields: `degrees` (e.g. `I–V–vi–IV` or modal equivalents), `mode`, `feel` tags
- relations: → songs that use it
- Payoff via MCP: "progressions I've used in the last five songs," "give me something modal I haven't leaned on" — songwriting history as queryable craft knowledge, matching how Tyler already thinks (the deliberate I–V–vi–IV avoidance on "Better").

## The chord canvas (Tier-3 custom canvas)

Section/line grid with chords attached to lyric syllables (not floating above text). Controls: transpose, key, capo, Nashville-toggle, section reorder (drag), progression picker (pulls from the progression DB, inserts + relates). A **fragment inbox** matters here — songs often start as "hum into phone → Apple Note fragment," so capture-of-fragments is as important as the chart editor.

*This is the clearest case for the custom-canvas capability (discussion doc #2). A chord grid is not a prose editor. If the capability isn't accepted, Songs forks to Tyler's instance.*

## Exporters

- **Chart PDF** (team-ready, chosen key)
- **Transposed chart** (any key / capo)
- **Nashville chart**
- **PCO push** — PCO Services API exposes songs/arrangements with a writable chart attribute; "finish in Ledgr, push to Planning Center" is realistic. *Verify OAuth scopes when specced.*

## Capture flow (interview note)

Songs start variably — lyrics first, progression first, or a Suno sketch first. The module needs a good **fragment inbox**, not just a chart editor: a lyric fragment, a "G Mixolydian, avoid I–V–vi–IV" note, a chord idea, or a Suno link all land as captures that later attach to a song. Charting itself is likely **desktop** work (mobile chord-grid editing is hard UI); on mobile the canvas is read + capture, not full editing. This shrinks the PWA/wrapper's song job to "read charts + capture fragments," which is very buildable.

## Open questions

1. PCO OAuth scopes for arrangement chart write — verify.
2. ChordPro dialect: strict ChordPro vs a superset for Nashville/modal annotations — settle at build.
3. Does the progression DB seed from existing songs (parse charts on import) or start empty and accrue — likely accrue.
