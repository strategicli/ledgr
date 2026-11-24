# next_steps.md: Ledgr Work Queue

**What's next, not what's done.** Finished work lives in git history, the PR that carried it, and the in-app Changelog, so nothing gets logged here after it ships: it just comes off the list. Update this when something actually lands, not on every push.

Anything that stops being live moves to `next_steps_archive.md`, which holds the finished and superseded sections through 2026-09-21 (158 of them) plus everything retired since.

---

## 🟡 NEXT — Claude Runs: switch it on and repoint the scheduled tasks (ADR-286, built 2026-09-30 on branch `claude-runs`)

Built and verified on the dev database, not yet merged. After it ships to the hub:
1. **Restart the supervisor once** (Build → Updates → Restart, or `npm run local:restart`). This release adds a nightly job and makes the hub's push keys, and both happen only when the supervisor starts (see the KNOWN STEP below).
2. **Turn on Claude Runs** at Build → Modules → Features.
3. **On the phone,** open the installed Ledgr app at the hub address, go to the home page, tap **Enable notifications**. The old subscription belonged to the Vercel copy and does not carry over.
4. **Repoint each scheduled Claude task** to end with: file a Claude Run with the report, tick Notify me only if Brandon needs to know. Then turn off the Claude app's notifications on the phone.
5. **First real ping is the proof.** If none arrives, Build → Errors will have a `claude-runs` row saying why.

## 🟡 NEXT: Year Map: remaining queue (ADR-287, slices 1 to 3 built 2026-10-02 on branch `feat/year-map`)

Slice 1 is a default-off module (Build → Modules → Year Map) with a "Year Map" saved view, per-view settings, a legend, and print. Slice 2 adds drag to move, edge drag to resize, and drag or double-click to create, with undo. Slice 3 adds an Outlook all-day and multi-day layer (More, needs calendar sync) and the "Next 3 Months (Year Map)" dashboard preset (Add widget, Prebuilt). Record and ceilings: `explorations/year-map.md`. Queue:
1. **Touch editing:** a long-press drag on phones (slice 2 is mouse and pen only, so the map still scrolls on touch).

## 🟡 NEXT — Presentations module: first real use (explorations/presentations.md)

Built 2026-09-26, off by default (Build → Modules → Presentations). Left for Brandon:
- Try **Open audience window** in a real browser with a second screen. Pop-ups couldn't be
  opened in the build session's browser, so the two-window sync was tested with a stand-in.
- Try **Save offline** on an item with pictures (the inlining path had no image to test).
- Open an exported **PowerPoint** in PowerPoint, and import the **ProPresenter** text file (File → Import) and/or the .pptx into ProPresenter 21+ at church. Both were checked by reading the files, not in those apps.
- Try a **background picture** with the darken slider, and a logo attached to the item (the build session used a color background and a pasted image).
- **Go live** links only work for viewers who can reach the address you present from.
  Present from the cloud copy for an outside audience; a hub on localhost is LAN/Tailscale only.

## 🟡 NEXT — Brandon's switch to the built-in password (ADR-274, by hand)

The built-in password sign-in shipped switched off everywhere; nothing changes on a copy
until its owner flips it (runbook §1o). Left for Brandon, in order:

1. Clerk dashboard → Configure → Restrictions: confirm sign-up is **Restricted** on his
   instance (Phase 0 check; it guards the Clerk door that stays open beside the password).
2. While signed in through Clerk: User Settings → Sign-in → set a password, save the kit.
3. Switch a spoke (the PC) first and live on it a few days, then the laptop hub (sign the
   phone app in again), then the Vercel copy. At each step confirm MCP, the API and the
   phone still work. Undo: User Settings → Sign-in → Switch to Clerk.

## 🟢 IN FLIGHT — self-hosted hub install plan, chunk A (Ledgr note "Ledgr install plan", 2026-09-25)

Step 1 (setup quick wins, ADR-275) landed: `/setup` in plain words, the first owner
made at the machine or by the first Clerk sign-in, a no-sign-in local copy answers
127.0.0.1 only, and the supervisor makes `LEDGR_OAUTH_SECRET` itself (runbook §1p).
Left over from step 1:
- The setup form asks for email and password only. Ledgr stores no owner name anywhere
  yet; add one when something displays it.
- The tray has no "Set up" item; its Reset sign-in password (and the installer's Start
  menu entry of the same name) lands on the setup form when there is no owner.
- The Clerk first-sign-in claim is proven on local Postgres; the Neon (Vercel) path runs
  the same lock through a one-transaction batch and has not been exercised on a real
  Neon database.

Step 2 (files on local disk) landed. Step 3 (private access through the bundled
Tailscale helper, ADR-276, runbook §1q) landed. Step 5 (public access through Tailscale
Funnel, only behind sign-in, ADR-279) landed.

Step 6 (ready-made packages, ADR-278, runbook §1s) landed: every push to `main` or
`prod-brandon` publishes a Windows x64 package as a GitHub Release (`pkg-<channel>-<version>`),
and an install can take its updates from those instead of building from git (Build →
Updates → Update policy → "Where new versions come from"). Every existing install,
Brandon's hub included, stays on git until its owner changes that. Left over from step 6:
- The in-app agent's platform binary (230 MB) is not in the package, so the agent module
  cannot run from one yet.
- No LICENSE file yet (plan decision 3), needed before anyone outside Brandon and Tyler
  installs a package.

Step 7 (the Windows installer, ADR-280, runbook §1t) landed: `Ledgr-Setup.exe` in every
package release, linked as "Download Ledgr for Windows" from the README and the user
guide. Per user, no Administrator prompt, ends on `/setup`; installs beside a git Ledgr
on free ports. Left over from step 7:
- Unsigned, so SmartScreen warns ("More info", then "Run anyway"). Signing needs a
  certificate (an account and a yearly cost).
- Not exercised: "Start with the computer → before anyone signs in" from an installed
  copy (it raises a UAC prompt), a Windows account whose name has a space end to end
  through the installer (the paths were tested with spaces by hand), and a machine
  whose Windows is not in English.
- The plan's first-run extras are not built: "start fresh or drop in a backup" and
  "Connect with Tailscale" on the setup page. Both exist elsewhere (restore from a
  backup is a terminal command; Tailscale is on Build → Network).

Step 8 (Mac and Linux, ADR-281, runbook §1u) landed, closing chunk A: packages for Mac
(Apple silicon and Intel) and Linux x64 in every package release, a one-line
`install.sh` (install, upgrade in place, `--uninstall` keeping data), start at sign-in
as a launchd agent or systemd user unit written by `ledgr-ctl startup` and the app's
box alike, and an `install-test` job that installs each fresh package on a real Mac and
Linux runner before anything publishes. Left over from step 8:
- Not exercised: the Intel Mac package (built, never installed), a real desktop
  sign-in, Gatekeeper on a person's Mac, the launchers opened from Finder or a desktop
  menu, and Linux other than Ubuntu (24.04 tested, 22.04 built on).
- No tray or menu-bar icon on Mac/Linux; the launchers and the app's pages stand in.
  The app has no Stop button (Stop Ledgr is a launcher).
- Unsigned and not notarized; fine through `curl`, but a browser-downloaded copy of
  anything would meet Gatekeeper.
- No Linux on Arm (a Raspberry Pi) package: it needs its own pins and runner.

Step 9 (keep a copy in the cloud, ADR-277, runbook §1r) landed: Build → Network pairs a
hub with a fresh cloud copy by a one-time code typed on the cloud's `/setup`, fills it
from one snapshot, lists it as a 15-minute copy, and share tokens now sync with one
public address for share links. Left over from step 9:
- Proven on two local installs (the cloud one run with `VERCEL_ENV=production` on local
  Postgres). Not yet run against real Vercel + Neon: the neon-http batch path for the
  fill, `ALTER TABLE … DISABLE TRIGGER` as Neon's owner role, the 60-second limit on a
  real fill request, and Neon's real storage figure.
- A stronger first-claim lock for a hosted copy (a setup code the Deploy Button asks for,
  chunk C) would close the two-hour window a stranger could use on an empty copy.
- "Check in now" still skips a copy set to "only when there are changes" when this machine
  has nothing to send (ADR-252 behavior, untouched); the paired copy is set without it.

## 🟢 IN FLIGHT — core and modules (ADR-272, started 2026-09-24)

One codebase, one `main`, installs differ only in which modules are on. Step 0 (the
core list, the ESLint fence, the ADR) landed with this section. The full six-step plan
is §6 of `explorations/core-and-modules.md`; each step is its own PR.

1. ~~Step 0: definitions and the fence.~~ Done.
2. ~~Step 1: the switch.~~ Done. `settings.modules`, a real `isModuleEnabled` (resolver
   seam in `src/lib/modules/enabled.ts`), and `/build/modules`.
3. ~~Step 2: fold the scattered switches onto that page.~~ Done. Five feature modules
   (`src/lib/modules/features.ts`), seeded once from the old keys by
   `seedModulesFromLegacy`; read sites use `moduleOn` / `moduleOnFor`. Build-nav's
   `gatedBy` became `module`. ~~Per-install switches (`snapshots:enabled`, `sync:mode`)
   are not on the page yet.~~ Now listed there too, under "Per-install settings".
4. ~~**Step 3: manifest slots replace the hand-written lists.**~~ Done, one PR each:
   `nav` (merged by `buildNavFor`; AI Memory moved onto its manifest, and a module
   that is off drops its Build page from the sidebar and the destination picker),
   `publicPaths` (empty until sharing, todoist and ICS become modules; the proxy takes
   every registered module's paths, on or off, and step 4 guards each route),
   the job catalog (`supervisor/jobs.json`, read by both the supervisor and the app)
   and job gating by module (a job whose module is off answers "module-off" and
   stands down), `mcpTools` (a tool no manifest claims is core), `healthCheck`
   (results under `/health` `checks.modules`; areas that are not modules yet stay in
   a marked block in `health.ts`), `hooks` (`src/lib/modules/hooks.ts`; passages is
   now a default-on module), and `requires` (`requiresViolations`, enforced on the
   Modules page and PATCH /api/settings; no module sets it yet). Done:
   `settingsPanel` (a panel id, not a schema) puts a module's options under its row.
5. **Step 4: move code under `src/modules/<id>/`**, easiest first (~~themes~~ stays
   core, see §5 of the exploration; ~~sharing~~ done, `src/modules/sharing/`;
   ~~youtube~~, ~~todoist~~, ~~email~~, ~~calendar-sync~~ (the Outlook pull only; event
   views, template match rules and the person suggester stay core), ~~onedrive-export~~,
   ~~relatedness~~, ~~snapshots~~,
   ~~passages~~, ~~desk~~, ~~ai-memory~~, ~~live-context~~, ~~agent~~, ~~MCP tool
   families~~ (stays core: each remaining family wraps a core library and has nothing
   an owner could switch off, see §5 of the exploration).
6. ~~**Step 5: lazy-load the shells**~~ done: the root layout lost 19.3 kB gzipped on
   every page, and the agent sidebar now downloads only when the agent is on (numbers
   in §7 of the exploration). Known leftovers: item-panel controls and RowMenu's Desk
   items still ship while their module is off; each needs a module-side change.
7. **Step 6: instance defaults** reviewed with Tyler; done when his install is the same
   build with a shorter default list. Rule (Brandon, 2026-09-25): defaults start from
   the plain product; Brandon's own workflow is which modules his install turns on.
8. **More modules, from the Ledgr task "Other ideas for things to move into modules".**
   ~~Batch A~~ (branch `feat/modules-batch-a`): Microsoft 365 parent module (calendar
   sync, email capture, OneDrive export require it), Meeting transcripts, Triage mode,
   Listen, and Passages off for new installs (ADR-273). **Batch B next:** move Person
   and Event out of `coreModule` into People and Events modules; Planner, the ICS feed,
   meeting transcripts and calendar sync require Events; the `@` create picker skips
   Person when People is off. Test on a data copy first. Later: Songs/Papers/Mindmap
   code move, builder tools, web clipper, push into Notification center, digest +
   Overview. Skipped: custom layouts. Parked: Google.
9. **Machine share route** (branch `feat/machine-share-route`): `POST /api/machine/items/<id>/share` lets a Flow Launcher plugin mint a share link with an API credential. Additive API surface, not core (ADR-183); listed in the Sharing manifest, 404 when Sharing is off. Not yet tried against a live credential.
10. **🅿️ PARKED, explore later (Brandon, 2026-09-29): make "off" structural, not remembered.**
    ADR-285 fixed the module-off leaks, but half of them by teaching each spot to check its
    switch (the agent health route, notification/push APIs, Save Offline's OneDrive leg, the
    `/ref` picker, the Today push toggle, the settings agent block, pinned nav slots). That
    works only as long as every future door remembers. Three ideas to explore:
    (a) one wrapper every module route/page is defined through, plus a CI check that any
    `src/app` file importing `@/modules/*` uses it (today `verify-module-registry` checks a
    few named pages by hand); (b) empty sockets in core screens (editor picker, Save Offline
    legs, Today, Settings) that only switched-on modules fill, so core stops naming modules;
    (c) finish step 4 for the Notification center (no `src/modules` folder yet; code is in
    `src/lib/notifications*` and `src/lib/push`) and move the passage picker into Passages.
    Also open: should items of a switched-off type be hidden from search and All items, and
    should a module offer "delete this module's data"?

## 🟡 FOLLOW-UPS — Claude in Ledgr (ADR-271, shipped 2026-09-24)

Built and live-tested on the hub (sidebar, tool calls, live edit of the open note,
Delete approval, inline edit, "/" prompts, "@" items, side chat with Bring back,
phone sheet at 375px). Left for real use to decide:
- **Phone over the tunnel.** Streaming was tested on localhost only. Open the sidebar
  on the phone through the public address and confirm a 1 to 3 minute turn streams
  without buffering or dropping (plan note 4, Phase 0 step 9).
- **Token cost.** Done 2026-09-24: seven core tools load every call, the rest wait
  behind ToolSearch, the cache lasts an hour, and the counter splits new from cached.
  Watch the Settings chart in real use; if a reserve tool turns out to be needed in most
  chats, add it to `CORE_TOOLS`.
- **Fake-SDK test** for turns, reconnect, and approvals (plan note 4, Testing) was not
  built; `verify-agent.mts` covers the safety rails only.
- **Eval pass** on inline edit after a few weeks: accept rates are in
  `agent_edit_proposals`.

## 📚 LONG-TERM — no user should meet a size cap on a note (Tyler, 2026-09-22)

**Where it stands:** ADR-270 made the 100K large-body gate per tab on tabbed canvases,
so a long work split into tabs never trips it. That is a workaround, not the answer.
Tyler's feedback on ADR-125: the whole-body cap came from Brandon's niche use (read-only
imported PDFs/ebooks at 1M+ characters) and shouldn't be a hard ceiling for every user.
"A user should be able to write a book using Ledgr," untabbed if they want.

**The real fix is the editor, not the threshold.** The freeze is one ProseMirror
`contenteditable` tree re-serialized per keystroke (ADR-125's measurement). Options to
weigh:
- **Section-windowed rich editing:** split an untabbed body at `#`/`##` headings (like
  tabs, but automatic and invisible) and mount only the sections around the viewport.
  Reuses TabbedBody's "one section per editor" trick without asking the writer to tab.
- **Debounced/incremental serialization:** stop calling `getMarkdown()` on the whole doc
  each keystroke; serialize on idle or only the changed top-level nodes. May lift the
  practical ceiling well past 100K on its own. Measure first.
- **Keep the gate only for imports:** a large body that arrived by import/upload (the
  PDF-as-text case) opens in Preview; a body a person wrote keeps rich editing.

Pick after measuring where the current editor actually starts to lag (typing latency at
100K, 250K, 500K), since the 100K line was set against crash reports, not a typing test.

## 🔜 OWED — templates can be applied over MCP but not made (found 2026-09-22)

**The gap:** `src/lib/mcp/tools/templates.ts` exposes only `list_templates` and
`apply_template`. Making, editing, or deleting a template is UI-only: the routes
under `/api/templates` are `requireOwner()` session auth, so neither the MCP nor
the machine API can reach them. Found while building a "Sermon Notes" template
for Tyler: Claude could write the prototype content as a normal note
(`e8083919-…`) but had to hand back the "Save as template" click, then clean up
the source note afterward.

**The fix is wiring, not new logic.** `src/lib/templates.ts` already has every
function, so each tool is a thin owner-scoped wrapper, additive per the ADR-183
carve-out:
- `create_template` — from an existing item (`createTemplateFromItem`, with an
  option to trash the source once cloned), or from scratch (`type`, `name`,
  title, body, properties → `createTemplate` + a prototype). The from-scratch
  path is the one agents want most, since it skips the throwaway source note.
- `update_template` — rename, set/clear `isDefault` for its type, edit
  `applyConfig` date rules (`updateTemplate`). Editing the prototype's body/props
  already works through `update_item` on `prototypeItemId`, as long as
  `list_templates` returns that id (check that it does).
- `delete_template` (`deleteTemplate`) and `duplicate_template`
  (`duplicateTemplate`).
- Mirror them on the machine API (`/api/machine/templates`) so a script can
  make a template with a byte-exact body.

**Gotchas to cover in the tool descriptions:** the `{{ask:Label}}` /
`{{today:long}}` token vocabulary (`src/lib/template-vars.ts`) versus the live
`{{now.*}}` / `{{item.*}}` tokens (`item-tokens.ts`), since mixing them up bakes
the wrong date; and that canvas tabs are just `<!-- tab: Title -->` lines in the
prototype body.

---

## ▶️ TWO-CLICK JOB FOR BRANDON — turn off PR previews on the `ledgr` Vercel project

Decided 2026-09-22: neither builder reviews a PR from a preview URL, so previews are quota burn. `devledgr`
already skips correctly. `ledgr` still builds a preview on every push.

Vercel → project **`ledgr`** → Settings → Git → **Ignored Build Step** → paste:

```
[ "$VERCEL_ENV" = "production" ] && exit 1 || exit 0
```

Exit 0 skips the build, exit 1 runs it, which is backwards from intuition. This kills previews and **never**
touches `release:prod`, which is always a production build. Not settable through the Vercel MCP (read-only on
this account), and it must not go in `vercel.json`, which is shared with Tyler's project. Runbook §1j-1.

## 🔜 DB-backed verify scripts: run on their own now, one latent date bug

All ~90 pass against dev as of PR #418 (2026-09-24). `release:prod` no longer runs them (they could never block a
release and were most of its runtime); run `npm run verify:db` when you want the report. A script that proves
itself can still move into `CORE_VERIFIES` in `scripts/release-prod.mjs` as a hard gate.

**Still latent:** `verify-mcp.mts`, `verify-meeting-prep.mts`, `verify-todoist-sync.mts` compute "today" with the
machine's local date while the code uses the owner's timezone (the bug fixed in `verify-view-tokens.mts` on
2026-09-22). They pass most of the day and can fail for the ~4 hours between UTC midnight and the app zone's
midnight. Fix by reading the same clock as the code (`todayBounds(new Date(), appTimezoneSync())`).

## 🔜 OWED — the write boundary still doesn't reject a malformed scaffold

Out of the incident above. `elements` on `SurfaceDef` now DESCRIBES the shape of a
structured surface (surfaced via `list_types` and `get_item`), which is what
would have stopped the guessing. It does not enforce anything. Still owed:

- **Reject unknown/malformed keys on a structured surface write**, naming the
  accepted ones. A typo like `heading` instead of `title` currently stores
  verbatim and renders as an empty section. Brandon's standing steer applies:
  warn about orphaned data, never rewrite it.
- **A partial-edit path for `sections`/`quoteBank`.** `propertyPatch` replaces the
  whole array, so an agent appending one quote has to read-modify-write the bank,
  and a concurrent UI edit is lost. Notes have `edit_item_body` for exactly this
  reason; these need the equivalent.
- **Check whether a paper's `properties.notes` picked up a child note's body.**
  Reported from the same session: notes came back holding the text of a separate
  "Assignment Brief" child note. Nothing in the code copies a child's body into
  `properties.notes` (the 2026-09-14 work folds notes INTO `body_text`, the search
  index, not the other way), so the likeliest answer is the agent wrote it there.
  Needs a look at the real record before assuming either way.

- Moved to `next_steps_archive.md`: "🐛 OPEN — `verify-sync.mts` is FLAKY (pre-existing, found 2026-09-11)"

- Moved to `next_steps_archive.md`: "🐛 OPEN — `verify-mcp-tasks.mts` has 3 date-rotted failures (pre-existing, found 2026-09-11)"

## 🧷 KNOWN STEP — a release that ADDS a scheduled job needs `npm run local:restart`

Discovered 2026-08-31 while switching on video transcripts. The supervisor decides which jobs exist when its process starts, and the auto-update path replaces the **app build** without restarting the **supervisor above it**. So a newly added job is missing from the schedule until the supervisor itself is restarted, and its "last ran" stays empty while everything else looks correct.

It is visible rather than silent: `npm run local:status` says "the running service predates the code on disk, restart to apply it" and names the command. But nobody would predict the need, and the symptom (feature switched on, owner named, code deployed, nothing happening) points everywhere except here.

**Options if it bites again:** have the update path restart the supervisor when `LOCAL_JOBS` has changed, or have the app surface the same warning on `/build/updates` where the job list is read. Both are small; neither is urgent now that the symptom is written down.

## 🔜 NEXT (queued out of ADR-243, deliberately not bundled)

Two adjacent gaps, both found while fixing the above, both left alone because neither was the reported bug:

- **Custom property VALUES are not validated against their kind.** `items.properties` is untyped JSON, so a `multi_select` can be given a bare string and a `select` an undeclared option, and both store silently and then render as nothing. Same shape of bug as ADR-243 one layer over. A genuine tightening with no loosening to justify it, so it needs its own decision (and Tyler, per ADR-183).
- **`update_type` replaces `propertySchema` wholesale and wipes it when the field is omitted** (it also requires `label`). So "add one property" or "add one option to a multi-select" means reading the current schema and resending all of it, and a caller that just wanted to rename the type drops every field. A surgical per-field tool (add / update / remove / reorder, plus option add/remove) would fix it, purely additively. Brandon's steer if it gets built: **warn about orphaned data, never rewrite it** — report how many items still hold a removed option or an old key and let him decide.
- **`move_item_type` does not re-validate status.** Move an item to a type that lacks its current stage and the row keeps a status the new type has never heard of. Pre-existing, unrelated to ADR-243, cheap to fix alongside either item above.

## 🔎 IDENTIFIED, NOT YET STOPPED — a stale peer has hammered the cloud hub every 12 seconds since ~2026-08-23

**This is what kept the production Neon compute from ever going idle,** and it is the reason the whole ADR-239/240/241 batch exists.

**The measurement.** A probe issuing one query a minute, and never reading the table in question, saw **+5 sequential scans of `sync_peers` and +14 commits every minute, with zero writes anywhere**, sustained for hours. Inter-arrival gaps clustered hard at 12.5 seconds.

**Vercel's logs named it.** `POST /api/machine/sync` returning **409**, every 12.06 seconds, user agent `node`, unbroken. 409 from that route is the schema version gate: the caller **authenticates successfully with a valid device token**, and is then refused because its bundled schema version disagrees with the hub's. So this is a real registered peer running stale code, not an intruder and not a bad token.

**Which machine.** Only two devices hold a token. Brandon's ECC laptop was ruled out by sampling every outbound HTTPS connection on it four times a second for a full minute: zero connections to anything, its only open socket being its local Postgres. The other peer is `BranRedux Desktop` (`bcdesktop`), which Tailscale shows **active** with a live direct connection. Its last SUCCESSFUL check-in was 2026-08-23; migrations landed on the hub 2026-08-25 and 2026-08-26, which is exactly when its version stopped matching. Roughly **50,000 requests** since.

**Why it never healed.** That install's supervisor is set to auto-update every 15 minutes, and the 409 carries both versions precisely so the stale side can raise an update card. It did not update, so either its supervisor is not running and only an orphaned app process survived, or its updates are failing.

**Next step is on that machine:** update it so its version matches (which also hands it the ADR-239 backoff), or stop its supervisor. Stopping the app alone is not enough if the supervisor restarts it. **Careful before anything destructive:** that install has not pushed since 2026-08-23, so it may hold local edits that never reached the hub, and its pull cursor may now predate the hub's retained oplog — in which case it needs a re-fill, and a re-fill destroys unpushed local changes. Measure the unpushed count first.

**The gap this exposed, now half closed.** A peer stuck on 409 was invisible to the hub: `last_seen_at` only advances on a SUCCESSFUL exchange, so the Network page reported "last seen August 23" while that peer was asking 7,200 times a day. The `fix/log-sync-409-caller` branch above now names the caller on the 409 path, which is the half that mattered and would have answered this in one query instead of a day. **Still open:** the 401 path is still silent, and neither rejection is surfaced anywhere the owner looks, only in the function log. Principle 9 wants both.

## 🅿️ FOLLOW-UP — the Network page does not show parked changes (ADR-241)

The hub now parks a change it cannot apply instead of re-sending it forever, records it in the errors list and returns it to the peer, and the peer counts it on the exchange result (`parkedOps`). What is missing is the sentence on `/build/network` saying "this copy could not accept N of your changes." Today you find out through the hub's own errors surface and the weekly health check.

`HubStatus` already carries `holdReason`/`heldOpsCount` in exactly this shape, so this is a surface, not new logic: add `parkedOps` to `HubStatus`, fill it from the exchange result beside the others, and render one line on the row. Do it the first time a parked change is noticed late.

- Moved to `next_steps_archive.md`: "📡 QUEUED — the hub calls the peer instead of the peer polling (core, write the ADR with it)"

- Moved to `next_steps_archive.md`: "🧹 QUEUED — every scheduled job should be movable, pausable, and off"

- Moved to `next_steps_archive.md`: "💾 QUEUED — the production database is 869 MB and most of it is dead space"

- Moved to `next_steps_archive.md`: "🎚️ FOLLOW-UP — the storage warning only fires on upload"

## Next up (in order)

**Slices 30–32 shipped this session (push notifications, public share links, provider-interface confirmation) — see the session-3 summary above and "Recently done."** Phase 2 is code-complete; what remains is the §1c-blocked matcher UIs below and Phase 3.

### Phase 3 (after Phase M): the Build surface UX
- **Reordered 2026-06-13 (Brandon):** building the UX is the priority after Phase M, ahead of the Claude layer and Notion migration. **Tier 1 — the Build surface shell + the custom type & property builder — is DONE (2026-06-13, ADR-044, slice 33; incl. the type/kind authoring UX).**
- **Tier 2 — templates — DONE (2026-06-13).** (a) **Workflow & wiki templates** ("New Workflow"/"New Wiki" → type + properties + starter views, wired into Work via the dashboard pin) — ADR-046, slice 35. (b) **Per-type item templates** (property defaults + starter body; the Phase-2 meeting-prep template is the forerunner) — ADR-045, slice 34. Both built on slice 33's type/property machinery.
- **Tier 3 — Claude layer — IN PROGRESS.** (a) **MCP server — DONE (2026-06-13, ADR-047, slice 36):** `POST /api/mcp`, hand-rolled Streamable HTTP, `mcp`-scoped machine token, six item tools. **Next: (b) scheduled Claude tasks** (morning briefing / weekly health check over the same token), then **(c) selective Notion migration.** Then **Tier 4** (planning rhythms + parked items). See `roadmap.md` Phase 3.

### (parallel) Editor parity / completeness — gaps from the M3 markdown cutover
The Tiptap editor (ADR-040) shipped the core path; a few BlockNote-era affordances didn't get ported. The R2 attachment backend (`/api/attachments`, presign, `src/lib/attachments.ts`, storage `putObject`) is all still in place, so these are re-wirings, not rebuilds. Not tier-ordered — slot against priority.
- **Inline image paste — REGRESSION (do first).** Phase-1-complete feature dropped by the cutover; `src/components/markdown-editor/` has no paste/drop/image handling at all. Add a Tiptap paste/drop handler → existing R2 presign → insert `![](url)`. Brandon confirmed broken (2026-06-13).
- **Tables.** GFM `| col |`: **editor-side only** — markdown-it already renders tables (default preset, `markdown-render.ts`), so just the first-party `@tiptap/extension-table` (+ row/cell/header) + toolbar + CSS. Low risk (same `@tiptap/*` vendor, markdown stays canonical, standard GFM serialization). Verify `@tiptap/markdown` table round-trip is lossless.
- **Paste / embed documents.** Was in the BlockNote canvas, not the markdown one. Decide markdown shape (R2 file link vs inline embed), then paste/drop → R2. Lower priority than image paste; recorded for later.
- Minor: strikethrough toolbar button (Strike already round-trips, just no button).

### (follow-up) Matchers: setup wizard + learn-by-confirmation UI
- The matcher **engine + config + suggested/confirmed states are done** (slice 23). Remaining: (a) **setup wizard** — sample recent/upcoming events and let Brandon pick matches → write first rules (needs live calendar; **§1c now live 2026-06-19, ready to build**); (b) **learn-by-confirmation** — when Brandon confirms a suggested match on a meeting (slice-15 confirm path), offer to save a standing rule (POST `/api/matchers`); the data backbone (`properties.match.matcherIds`, the matchers API) is already in place. §1c is now live (2026-06-19), so pick these up whenever; the meeting canvas shows matches.

---

## Open decisions to make as we build
- ~~Entity `kind`~~: decided, real column on `items` (ADR-003); **later dropped** with the `entity`→`person` collapse (ADR-055) — sub-classification is now a `select` property, and list-filtering by it is a near-term view-engine item (see Views).
- ~~OneDrive export file scope~~: decided, app-only client credentials (ADR-017).
- ~~Error capture~~: decided, `error_log` table over Sentry (ADR-020).
- Desktop navigation: floating bottom bar vs right sidebar (PRD Q9). Both built behind the same slot model; Brandon picks, loser gets deleted.
- Per-type item templates (tasks/meetings/notes storing property choices + starter content) parked for a later phase (roadmap Phase 3); the meeting-prep template is the Phase 2 forerunner.
- ~~"Project" treatment for subtask-having items~~: confirmed a project is **relations, not a type** (ADR-061); a project treatment, if built, is a presentation layer only. Still parked in `explorations/project-items.md`.
- ~~Notes organization (files/folders vs sub-pages vs tags)~~: decided **relations-primary, notes-as-a-module-on-every-type** (ADR-061). The remaining open piece is the **export → MD-file-tree mapping** (`explorations/storage-organization.md`).
- ~~What does Share output~~: decided **Share/Print renders the canvas**, with a per-property "include in share?" toggle (ADR-062). Per-type field sets still decided type by type.
- ~~Entity vs. custom type~~: **RESOLVED** — the `entity` meta-type was retired → bespoke `person`, `kind` dropped, the related list made universal (ADR-055); the `relation` property kind stays deferred. See `explorations/entity-vs-custom-type.md`.
- See `decisions.md` for the running log and PRD §10/§11 for what's already frozen vs still open.

---
