import { NextResponse } from "next/server";
import { errorResponse, requireOwner } from "@/lib/api";
import { searchItems, type SearchOptions } from "@/lib/search";
import { RECENCY_STRONG } from "@/lib/recency";
import { getAppTimezone, ymdInZone, zonedMidnightUtc } from "@/lib/today";
import { getSettings } from "@/lib/settings";
import { parseFuzzyWhen } from "@/lib/nl-date";
import { expansionCount } from "@/lib/synonyms";
import {
  CONFIDENCES,
  deepSearch,
  type Confidence,
  type Criterion,
  type DateSource,
} from "@/lib/search-deep";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// from/to arrive as calendar days (YYYY-MM-DD) and become an app-timezone
// window: from's midnight inclusive through the end of to's day (next
// midnight, exclusive).
function dayStart(value: string, tz: string, nextDay = false): Date | null {
  const m = YMD_RE.exec(value);
  if (!m) return null;
  return zonedMidnightUtc(
    { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) + (nextDay ? 1 : 0) },
    tz
  );
}

// --- Fuzzy-search params (ADR-172) -----------------------------------------
// Confidence rides as a `~stop` suffix on the value it qualifies:
//
//   ?term=teaching~sure&term=sermon~might&when=last+month+sometime~probably
//   &whensrc=updated&type=note~might&tag=campus:WPN~might
//
// Deliberately an extended GET, not a POST body: a search worth finding twice is
// worth bookmarking, and Ledgr already passes ?q= URLs around (the Discover
// handoff). `~` rather than `:` separates the stop because a tag VALUE can
// legitimately contain a colon ("Campus: WPN"), and `~` is URL-unreserved.
//
// BACK-COMPAT MATTERS HERE: a suffix-less `type=note` / `person=<uuid>` keeps
// meaning exactly what it means today (a hard filter), and a plain `q=` with no
// deep params runs the untouched exact path. Quick search, the command palette,
// and the @ typeahead are therefore bit-for-bit unaffected.
function splitConfidence(
  raw: string,
  fallback: Confidence = "sure"
): { value: string; confidence: Confidence } {
  const at = raw.lastIndexOf("~");
  if (at === -1) return { value: raw.trim(), confidence: fallback };
  const stop = raw.slice(at + 1).trim().toLowerCase();
  const confidence = (CONFIDENCES as readonly string[]).includes(stop)
    ? (stop as Confidence)
    : fallback;
  return { value: raw.slice(0, at).trim(), confidence };
}

// whensrc=created | updated | prop:<key>. Defaults to updated ("when was I last
// working on it"), the reading that matches the recency signal elsewhere.
function parseDateSource(raw: string | null): DateSource {
  if (raw === "created") return { field: "created" };
  if (raw?.startsWith("prop:")) {
    const key = raw.slice(5).trim();
    if (key) return { field: "property", key };
  }
  return { field: "updated" };
}

// GET /api/search
//   exact mode (unchanged): ?q=&type=&person=&from=&to=&limit=&recency=
//   fuzzy mode (ADR-172):   any term= / when= param, or any ~confidence suffix
export async function GET(request: Request) {
  const owner = await requireOwner();
  if (owner instanceof NextResponse) return owner;

  try {
    const params = new URL(request.url).searchParams;
    const q = params.get("q")?.trim() ?? "";

    const termParams = params.getAll("term").filter((t) => t.trim());
    const tagParams = params.getAll("tag").filter((t) => t.trim());
    const whenParam = params.get("when")?.trim() ?? "";
    const suffixed = ["type", "person"].some((k) => params.get(k)?.includes("~"));
    const fuzzy = termParams.length > 0 || tagParams.length > 0 || !!whenParam || suffixed;

    const limitParam = params.get("limit");
    const limit = limitParam !== null ? Number(limitParam) || undefined : undefined;

    if (fuzzy) {
      const tz = await getAppTimezone(owner.id);
      const { y, m, d } = ymdInZone(new Date(), tz);
      const todayYmd = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const settings = await getSettings(owner.id);
      const personal = settings.searchSynonyms;

      const criteria: Criterion[] = [];
      // The plain box composes with the tuned rows: whatever is typed there is
      // simply the first word, at full confidence.
      if (q) criteria.push({ kind: "term", value: q, confidence: "sure" });
      for (const raw of termParams) {
        const { value, confidence } = splitConfidence(raw);
        if (value) criteria.push({ kind: "term", value, confidence });
      }

      const typeRaw = params.get("type");
      if (typeRaw) {
        const { value, confidence } = splitConfidence(typeRaw);
        if (value) criteria.push({ kind: "type", value, confidence });
      }

      const personRaw = params.get("person");
      if (personRaw) {
        const { value, confidence } = splitConfidence(personRaw);
        if (!UUID_RE.test(value)) {
          return NextResponse.json({ error: "person must be a UUID" }, { status: 400 });
        }
        criteria.push({ kind: "relation", value, confidence });
      }

      for (const raw of tagParams) {
        const { value, confidence } = splitConfidence(raw, "might");
        // key:value, split on the FIRST colon so a value may contain one.
        const at = value.indexOf(":");
        if (at <= 0) continue;
        const key = value.slice(0, at).trim();
        const tagValue = value.slice(at + 1).trim();
        if (key && tagValue) criteria.push({ kind: "property", key, value: tagValue, confidence });
      }

      // A date phrase if given, else the explicit from/to inputs as the plateau.
      // Either way it becomes a SCORED criterion, never a filter: the confidence
      // dial sets how sharply the score falls off outside the range (see
      // lib/search-deep.ts). An unparseable phrase is reported back so the UI can
      // say so rather than silently searching a window nobody asked for.
      let whenError: string | null = null;
      const source = parseDateSource(params.get("whensrc"));
      if (whenParam) {
        const { value, confidence } = splitConfidence(whenParam, "probably");
        const when = parseFuzzyWhen(value, todayYmd);
        if (when) criteria.push({ kind: "date", source, when, confidence });
        else whenError = value;
      } else {
        const from = params.get("from");
        const to = params.get("to");
        if (from || to) {
          const stop = params.get("whenconf")?.trim().toLowerCase() ?? "";
          const confidence = (CONFIDENCES as readonly string[]).includes(stop)
            ? (stop as Confidence)
            : "sure";
          criteria.push({
            kind: "date",
            source,
            when: {
              from: from && YMD_RE.test(from) ? from : null,
              to: to && YMD_RE.test(to) ? to : null,
              softDays: 3,
              label: "",
            },
            confidence,
          });
        }
      }

      const items = await deepSearch(owner.id, criteria, { personal, limit });
      // Per-term expansion counts for the "+ 6 synonyms" hint. Computed here
      // because lib/synonyms.ts carries a ~1.8MB WordNet map that must never
      // reach the browser bundle.
      const expansions: Record<string, number> = {};
      for (const c of criteria) {
        if (c.kind === "term") expansions[c.value] = expansionCount(c.value, personal);
      }
      return NextResponse.json({ items, expansions, whenError });
    }

    // --- Exact mode: byte-for-byte the pre-ADR-172 behavior. ---------------
    if (!q) return NextResponse.json({ items: [] });

    const opts: SearchOptions = { type: params.get("type") ?? undefined };
    // Quick search (command palette) leans hard on recency; the full search
    // page omits the flag and gets the mild default.
    if (params.get("recency") === "strong") opts.recency = RECENCY_STRONG;
    const person = params.get("person");
    if (person) {
      if (!UUID_RE.test(person)) {
        return NextResponse.json(
          { error: "person must be a UUID" },
          { status: 400 }
        );
      }
      opts.relatedTo = person;
    }
    const tz = await getAppTimezone(owner.id);
    for (const [param, key, nextDay] of [
      ["from", "from", false],
      ["to", "to", true],
    ] as const) {
      const value = params.get(param);
      if (value) {
        const date = dayStart(value, tz, nextDay);
        if (!date) {
          return NextResponse.json(
            { error: `${param} must be YYYY-MM-DD` },
            { status: 400 }
          );
        }
        opts[key] = date;
      }
    }
    if (limit !== undefined) opts.limit = limit;

    return NextResponse.json({ items: await searchItems(owner.id, q, opts) });
  } catch (err) {
    return errorResponse(err);
  }
}
