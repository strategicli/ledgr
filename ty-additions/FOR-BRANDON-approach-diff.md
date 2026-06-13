# For Brandon — Where Tyler's Build Meets Yours

**From:** Tyler
**Re:** Ledgr v0.17 → building on it together
**Purpose:** Lay out, plainly, where my plans match your system, where they differ, where I want to extend it, and the few places we may want to build separately. This is a discussion doc, not a decision. Nothing here is built yet.

---

## The headline

I read the whole PRD (v0.17), the schema, the decision log, the roadmap, and the work queue. **I want to build on your system, not beside it.** You did not build a Notion clone — you built typed system-objects with bespoke code, a custom-type sandbox for the tail, real relations, weighted FTS, and an MCP server as a first-class principle. That is almost exactly the foundation I'd have specced, and the June 11 call already shaped pieces of it (§4.10, §4.14). So the question isn't "your way or mine," it's "can my tools live inside your system without bending its architecture?" My read: **yes, with one new pattern and a handful of seams you'd arguably want anyway.**

The proposed shape: **shared codebase, separate single-tenant deployments.** Your `owner_id`-everywhere discipline already makes this a non-event — I deploy my own Vercel project against my own Neon DB, my pastoral/personal data never touches your instance, and we share schema + core code. I bring three things that serve *your* PRD's own open questions, plus some that are purely mine and burden you not at all.

---

## Where we're the same (no discussion needed)

- **Typed system-objects + custom-type sandbox.** Your §3.7 three-tier model is the thing I'd have argued for. The explicit rejection of pure-generic ("makes integration plumbing brittle") is exactly right.
- **Relations as a real edge table** with roles and `confirmed`/`suggested`. No notes.
- **Claude as a first-class client via MCP** (your Principle 4). This is my whole reason for existing; we just disagree on *timing* (below).
- **Stack.** Next.js/Vercel, Neon via pooler, Drizzle, Clerk, R2. Identical.
- **Owner-scoped from day one.** Makes separate deployments trivial.
- **Markdown as a portability layer.** You export to it; I want to lean on it harder (below) — but we agree it matters.

## Where we differ (worth a conversation)

1. **Canonical body format, per type.** You made **BlockNote JSON canonical** and markdown the lossy export, because sermons use colors/highlights. I agree *for your types*. But I want some of *my* types (papers, songs, slides) to treat **markdown (or ChordPro) as the canonical body** and render BlockNote/Word/PDF/chart as the derived artifacts. This isn't a conflict — it's "canonical body format is a property of the type, not the platform." Your items table already stores `body` as jsonb; a markdown-canonical type just stores `{format: "markdown", text: "..."}` there instead of BlockNote JSON. **Discussion:** are you OK with the platform supporting more than one canonical body format, keyed off type? I think it costs you nothing and you might want it later (a Scratchpad type, say).

2. **Todoist conflict rule.** You're Ledgr-canonical with completions/dates syncing back, recurrence fully delegated. I originally wanted last-write-wins. Having read your reasoning, **I think yours is better** and I'll adopt it. Flagging only so you know I looked and agreed, not missed it. (I may also drop Todoist entirely down the line, but that's a per-instance choice the adapter already isolates.)

3. **MCP timing.** You've got it in Phase 3. It's closer to day-one for me — it's how I draft papers and organize quote banks. Machine-token auth (slice 3) and the clean API already exist, so pulling MCP forward is mostly additive. **Discussion:** I'd build it early in my instance; would you want to take the early version once it's proven, ahead of your Phase 3?

## Where I want to extend (new architecture, needs your buy-in)

4. **Contributed workflow modules** — the one genuinely new pattern. A *module* = a system type + a custom canvas + exporters + (optional) an integration, packaged as a unit. This extends your §3.7 Tier-3 ("type-specific code, built-ins only") and your §4.14 Build-surface workflows. My four: **Papers, Songs, Sermons/Lessons, Discipleship.** The custom canvas is the only real stretch against your architecture — §4.13 says every item opens to the same editor canvas. A chord chart or a paper-with-quote-bank wants a *different* canvas. **This is the single most important thing to agree on:** are you OK with "a system type may declare its own canvas component" as a platform capability? If yes, we co-own cleanly. If you hold hard to "every item is the BlockNote canvas, period," that's the honest signal that Songs/Papers fork into my instance — still fine, I inherit your 15 slices either way.

5. **Scripture references as first-class entities** (a new `entity.kind = passage`). Links Savor commentary, songs, sermons, papers, and quotes *through the text itself*. "Everything I've touched on Hebrews 4" becomes one query. Cheap (it's just another entity kind) and I think you'd want it too.

6. **Provider seam for calendar + email.** You're Microsoft (Graph calendar, Outlook-folder email-in, OneDrive export, MS sign-in). I'm **Google Workspace + iCloud.** Your §6.1 already preaches provider-interface discipline for storage/auth/scheduler; I want to extend it to **calendar and email-in** (your adapter = Graph, mine = Google). **This directly answers your own open question 7** ("do non-Microsoft users need Google equivalents"). Building the seam makes Ledgr genuinely generalizable instead of Brandon-shaped — a win for both, and the work lands in my instance first.

## Where we likely separate (and that's fine)

7. **iOS native wrapper (App Store).** A Capacitor/WKWebView shell over the PWA for real push, home-screen widgets, and a record button. **Non-negotiable for me, probably unnecessary for you** (your PWA-content posture is reasonable). It's purely additive — a wrapper over a clean web app burdens nothing in your instance — but it means I make a few PWA decisions (service-worker seams, share target, Clerk-in-webview) *wrapper-aware* from the start. Your §4.16 PWA slice is next in the queue, so the timing to coordinate this is now.

8. **My integrations: Savor + Atlas.** Savor (my Scripture-journaling app — pulls devotional commentary into the brain, read-only) and Atlas (church ops — work tasks/projects) are mine. They live behind the same seams and never touch your instance.

---

## The one open question I still owe an answer on

**Discipleship privacy tier.** Pastoral/relationship content needs stricter handling. You deferred a field-encrypted "confidential" tier. My lean is lighter: a `confidential` flag that **excludes items from MCP, export, and briefings** while keeping them searchable inside the authed app — "Claude can't see it, nothing surfaces it, it never leaves the app." Full field-level encryption is the heavier alternative. **Undecided.** You have the same need (pastoral notes), so this is worth deciding together.

---

## Proposed decision points for our conversation

1. Multiple canonical body formats keyed off type — yes/no? *(unlocks Papers + Songs)*
2. "A system type may declare its own canvas" as a platform capability — yes/no? *(the co-own vs fork hinge)*
3. Calendar/email provider seam — build it together (closes your Q7) or I build it solo in my instance?
4. MCP pulled forward — do you want the early version?
5. Confidential tier — flag-excludes-from-MCP (my lean) vs field encryption?
6. Monorepo-with-separate-deploys vs I-fork-and-PR-upstream — which collaboration shape?

If 1, 2, and 6 land favorably, we co-own a single system with two cockpits. If 2 goes the other way, Papers/Songs fork and everything else still shares. Either outcome is good.
