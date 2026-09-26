# Presentations module (plan, 2026-09-26)

Status: **built** (all six steps, 2026-09-26). First-use checks are in `next_steps.md`.

Known limits: live-follow state lives in `job_state`, which does not sync between installs, so viewers must reach the same copy the presenter uses. Followers poll once a second, which is one database read per viewer per second. That's fine for small rooms.

## Why

Brandon drives slides from his laptop in smaller rooms. The main stage keeps ProPresenter. Ledgr already marks screen text with the **slide mark** (`<ins class="slide">`, ADR-176) and exports a booth copy. This module adds the missing piece: a player that shows those slides directly.

## Shape

A module, **off by default**, under `src/modules/presentations/`. There's no new table, no migration and no new dependency. The body format doesn't change: `---` is plain Markdown, and notes reuse the CriticMarkup comments already in the dialect.

## How a body becomes slides (`lib/deck.ts`, pure)

- **Manuscript mode.** Used when the body has any slide mark. Each marked span is a slide (reusing `boothExport`, so numbering matches the booth copy). The prose between one cue and the next is that slide's speaker notes. A title slide leads, carrying the intro prose as its notes.
- **Deck mode.** Used otherwise. A `---` line starts a new slide, but only when a blank line comes before it, because `Text\n---` is a heading in CommonMark. With no `---` breaks, each H1 or H2 starts a slide. Comments (`{>>note<<}`) become notes and are removed from the slide.
- **Auto layout.** Layout comes from what's on the slide: a lone image fills the screen, a lone quote gets a quote layout, a short single line is shown big, and anything else is normal. Text shrinks to fit.

## Player (`/items/[id]/present`)

- One self-contained HTML page (inline CSS and JS, deck data embedded), served by a route handler. The same bytes are the offline download.
- **Two windows.** The audience window shows the slide. The presenter window shows the current and next slide, notes, an elapsed timer and the clock. They sync with `postMessage` between the opener and the window it opened, which also works from a `file://` download, where BroadcastChannel does not.
- **Keys:** arrows, space, PageUp/PageDown (which clickers send), Home/End, B or `.` for black, W for a title screen, a number then Enter to jump, F for full screen.
- **Build lists** as a presenter toggle (remembered per browser): each list item is a step.
- **Pre-service countdown:** the presenter enters minutes, and the audience sees a countdown until the first advance.
- **Live edits:** while online, the page polls for changes every 5 seconds and swaps the deck in place. It keeps the current slide.
- **Deliberately skipped:** stage messages (the laptop driver is the stage), background layers, transitions beyond a fade, and a slide designer.

## Steps

1. **Deck parser** with a pure verify script.
2. **Player route and page**: audience and presenter windows, keys, layout, fit text, build lists, timer, countdown, live polling.
3. **Module wiring**: the manifest, a Present button in Export & sharing, and the user guide.
4. **Offline download** (`?download=1`): the same page as an attachment, with `/files/<id>` images inlined as data URIs so it works with no network.
5. **Embed an item in a slide.** A slide whose only content is one item link (`[@Title](ledgr://item/<id>)`) shows that item instead. If that item has slide marks or `---` breaks, its slides are spliced in. Otherwise its body is one slide. Depth is capped at 1.
6. **Public live follow.** "Go live" mints a random token, stored in the `job_state` key/value table (no migration). `/live/<token>` serves the player in follow mode, which polls a small public state endpoint, so viewers see exactly what the presenter shows. "End" revokes the token.

## Round 2 (2026-09-26): design, transitions, exports

- **Design** (`lib/design.ts`, the contract; `parseDesign` is the trust boundary). It's saved per item at `properties.presentation`, and the owner default at `settings.presentationDefault`. It covers the theme (Dark, Light, Gray, Sepia, from Ledgr's app themes) with text and heading color overrides, the logo (corner, margin, size, hide-on-slides), the background (color or image, darken 0–90%, full-brightness slides; darkening applies to images only), and the title bar (text, top or bottom, size, margin, hide-on-slides). Slide lists are 1-based numbers like `1, 5-7`. Images must be Ledgr attachments or inlined data, never an outside address.
- **Transitions:** None, Fade, Fade through black, Fade up/down, Wipe up/down, and Grow, at Fast, Normal or Slow speed, with `cubic-bezier(0.2,0,0,1)` easing. They use two stacked layers and the Web Animations API, which works from `file://` (View Transitions do not). Reduced motion gets a 150 ms fade.
- **Exports:**
  - **PowerPoint** (pptxgenjs, loaded only on export): editable text, design, and notes. No transitions.
  - **ProPresenter:** a `.txt` with blank-line-separated slides, text only, so the booth theme applies.
  - **PDF:** the page's own print layout (`?print=1`, or `?print=notes` for a portrait handout).
  - **PNG/JPG:** SVG `foreignObject` onto a canvas at 1920×1080, packed with a store-only zip written inline.
