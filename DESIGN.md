---
name: Ledgr
description: A dense, warm, editorial dark-mode personal life system — a living ledger of one working life.
colors:
  accent: "#2563eb"
  surface-0: "#191919"
  surface-1: "#1e1e1e"
  surface-2: "#262626"
  surface-3: "#2f2f2f"
  line: "#2a2a2a"
  line-strong: "#383838"
  ink: "#e8e8e8"
  ink-muted: "#a0a0a0"
  ink-subtle: "#6f6f6f"
  ink-faint: "#4d4d4d"
  danger: "#dc2626"
typography:
  display:
    fontFamily: "Bricolage Grotesque, Geist, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.011em"
  title:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.011em"
  body:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "normal"
  label:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.06em"
  meta:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.35
    letterSpacing: "normal"
  mono:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  card: "10px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.card}"
    padding: "6px 10px"
  button-destructive:
    backgroundColor: "{colors.danger}"
    textColor: "#ffffff"
    rounded: "{rounded.card}"
    padding: "4px 10px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.card}"
    padding: "4px 10px"
  card:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "11px 14px"
  popover:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "12px"
---

# Design System: Ledgr

## 1. Overview

**Creative North Star: "The Living Ledger"**

Ledgr is the confident, typographic record of one working life. It is dark by default, dense by intent, and warm on purpose. The register is product: design serves the tool. Every screen exists so a fluent power user can find, read, and act on their meetings, tasks, notes, people, and bespoke content faster than they could anywhere else, and still feel glad to be here after the tenth hour of the week. Warmth comes from restraint and craft, not decoration: legible ink, quiet hairlines, one honest accent, and typography that reads like a well-set document rather than a form.

The system is built as tokens, not constants, because it is skinnable. A single per-owner accent (default a clear blue) drives every highlight; the neutral surface ramp and semantic ink scale are runtime CSS variables so a light theme, or a second user's palette, flips in one place. This pass documents "Brandon's feel" (dark), but nothing here should hardcode a color a user is meant to own. The two surfaces, Work (daily, mobile-fluid, glanceable) and Build (configuration, desktop-first, deliberate), are one product with one visual language; the difference is posture, never a second skin.

Ledgr explicitly rejects the generic SaaS dashboard (gradient hero-metric tiles, endless identical icon-heading-text card grids), the corporate/enterprise console (sterile heavy chrome, toolbar walls), and the Notion re-skin (a generic database wearing a coat of paint). It is bespoke-first: each type earns its own shape.

**Key Characteristics:**
- Dark-default, single warm accent, everything else neutral.
- Dense and fast, but readable: favor the ink end of the ramp over elegant light grays.
- Editorial hierarchy: type and space carry structure, not boxes and borders.
- One radius, one accent, one voice across Work and Build.
- Tokenized and skinnable: colors are owner-configurable variables.

## 2. Colors

A near-black neutral field carrying a single owner-chosen accent; no secondary or tertiary hues, so the accent's rarity is what gives it weight.

### Primary
- **Owner Accent** (#2563eb default, per-owner): The one voice. Highlights, checkbox fills, count badges, active nav, focus rings, section icons, the Build wordmark glow. Set per owner on `<body>` from user settings and may be a gradient (`--accent-gradient`) for fills. Never assume blue; assume "the accent."

### Neutral
- **Surface 0 — Page** (#191919): The base field everything sits on.
- **Surface 1 — Panel / Card** (#1e1e1e): Cards, canvas panels, popover-adjacent panels.
- **Surface 2 — Raised** (#262626): Hover, selection, raised rows.
- **Surface 3 — Popover** (#2f2f2f): Menus, popovers, floating surfaces.
- **Line** (#2a2a2a): The quiet hairline — dividers, default borders. One tone quieter than the old gray-box border.
- **Line Strong** (#383838): A border meant to be seen.
- **Ink** (#e8e8e8): Primary text.
- **Ink Muted** (#a0a0a0): Secondary text, section labels.
- **Ink Subtle** (#6f6f6f): Meta, timestamps, counts.
- **Ink Faint** (#4d4d4d): Disabled, faint.

### Named Rules
**The One Voice Rule.** There is exactly one accent, and it is the owner's. Do not introduce a second brand hue to add interest; interest comes from hierarchy and type. Semantic red (#dc2626) for destructive actions is the only other permitted color, and it means danger, never decoration.

**The Ink-End Rule.** When body-text contrast is even close, bump toward ink, never toward elegance. Light gray body text on the dark field is the single biggest readability failure; muted grays are for labels and meta, not for content the user reads.

## 3. Typography

**Display Font:** Bricolage Grotesque (reserved almost entirely for the logo/wordmark; `--font-logo`)
**Body / UI Font:** Geist (with Arial, Helvetica fallback)
**Mono Font:** Geist Mono

**Character:** One clean, contemporary sans (Geist) does nearly all the work across UI and prose, in multiple weights, so the interface reads as one continuous document. Bricolage Grotesque appears only as the brand voice at the wordmark, a single deliberate contrast note, not a body pairing. Mono is for code, tokens, and fixed-width data.

### Hierarchy
- **Display / Title** (600, 1.5rem/24px, 1.2, -0.011em): Page and screen titles (`.ui-title`).
- **Section Label** (500/600, 0.8125rem/13px, +0.06em, uppercase): Section headers and canvas-section titles (`.ui-section-label`).
- **Body / Row** (400, 0.875rem/14px, 1.35): List rows, canvas prose, the workhorse size (`.ui-row`).
- **Meta** (400, 0.75rem/12px): Timestamps, counts, secondary detail (`.ui-meta`).
- **Prose canvas**: owner-scalable via `--prose-font-size`; the editor body respects the user's chosen reading size.

### Named Rules
**The One-Family Rule.** Geist carries the system in weights and sizes; do not introduce a second UI sans "for contrast." The only sanctioned second face is Bricolage Grotesque, and only at the wordmark.

**The 8px Grid Rule.** Spacing lands on the 8px grid (Tailwind 2/3/4/6/8/10/12). No ad-hoc mt-5/mt-7/mt-9. The whole UI also scales together from one `--ui-scale` knob, so rem-based dimensions stay in proportion.

## 4. Elevation

Flat by default. Depth is carried by tonal layering of the surface ramp (0 → 1 → 2 → 3), not by shadows: a panel is a lighter surface, a hover is one step brighter, a menu is brighter still. Real shadows appear only where something genuinely floats above the page (popovers, dialogs, the mobile nav pill) as a soft dark drop, never as ambient decoration on cards.

### Shadow Vocabulary (sparingly)
- **Floating** (`box-shadow: 0 10px 30px rgba(0,0,0,0.5)` range): Popovers, dialogs, the floating nav pill. Signals "above the page."
- **Accent glow** (`filter`/`text-shadow` with `color-mix(... var(--accent) ...)`): Reserved for intentional signals — the Build wordmark breathing glow, the dashboard resize handle. Not a default.

### Named Rules
**The Tonal-Depth Rule.** Convey elevation by moving up the surface ramp, not by adding a shadow to a card. A card with a drop shadow at rest is wrong; a card that becomes `surface-2` on hover is right.

## 5. Components

### Buttons
- **Shape:** One radius family — `rounded-card` (10px) for standout buttons, `rounded` for compact inline actions. Never mix arbitrary radii.
- **Primary:** Accent background, white text, tight padding (~6px 10px). Rare; most actions are ghost.
- **Ghost (default):** Transparent, `ink-muted` text, `surface-2` on hover. The workhorse; most row and toolbar actions.
- **Destructive:** `danger` (#dc2626) background, white text. Only for delete/irreversible, and paired with a confirm popover and an undo toast (ADR-142), never a bare button.
- **Hover / Focus:** Background shifts one surface step; focus-visible draws a 2px accent outline, offset 2px.

### Cards / Containers
- **Corner Style:** `rounded-card` (10px), the one unified radius across panels, rows, and menus.
- **Background:** `surface-1`; hover/selected `surface-2`.
- **Border:** `line` hairline (or none in the lighter canvas weights); `line-strong` only where a border must be seen.
- **Shadow Strategy:** None at rest (see Elevation).
- **Internal Padding:** ~11px 14px, on the 8px grid.
- **Canvas sections** carry three owner-selectable weights (heavy = bordered card, light = divider rule only, unified = flat stack), flipped by one `[data-section-style]` body attribute so every panel agrees.

### Inputs / Fields
- **Style:** Dark fill on the surface ramp, `line`/`line-strong` stroke, `rounded-card`. `color-scheme: dark` is global, so native controls (scrollbars, date/select pickers) render dark without per-field guards.
- **Focus:** Accent border/ring; visible, not glowing.
- **Placeholder:** Must hit body contrast (4.5:1), not the faint default.
- **Checkbox:** The circular `.ledgr-check` — gray ring on dark, fills with the accent and a white check when ticked.

### Navigation
- **Work nav:** Owner-configurable. Mobile is a floating bottom pill (scrollable slot strip, hidden scrollbar); sm+ docks as a top bar or side rail with `--nav-*` body-padding clearance.
- **Build nav:** A fixed, hardcoded left sidebar grouped under DATA / INTERFACE / MAINTAIN, with the breathing accent "Build Mode" wordmark as the "you are here" signal.
- **States:** Active uses the accent; hover uses `surface-2`. Same language on both surfaces.

### Signature: Multi-select & Row actions
- **Selection:** Every list gets opt-in multi-select (off by default, ADR-118/121): a `SelectModeToggle`, leading `SelectCheckbox` per row, and a floating `BulkActionBar`. The checkbox column collapses to zero when off.
- **Row menu:** Actions live in a shared `RowMenu` opened by right-click / long-press (ADR-142), plus a global undo toast. No always-visible per-row action buttons.

## 6. Do's and Don'ts

### Do:
- **Do** style refreshed surfaces from the token layer: `bg-surface-{0,1,2,3}`, `border-line`/`border-line-strong`, `text-ink`/`text-ink-muted`/`text-ink-subtle`/`text-ink-faint`, `rounded-card`, and the `ui-*` type scale on the 8px grid.
- **Do** treat the accent as the owner's single voice, set from `--accent`; support gradient fills via `--accent-gradient`.
- **Do** convey depth by moving up the surface ramp; make hover `surface-2` and menus `surface-3`.
- **Do** favor the ink end of the ramp for anything the user reads; reserve muted grays for labels and meta.
- **Do** keep Work and Build visually identical in language; vary only posture (glanceable vs. deliberate, mobile-fluid vs. desktop-first).
- **Do** honor `prefers-reduced-motion` on every animation (the Build wordmark glow and any reveal already do).

### Don't:
- **Don't** build a generic SaaS dashboard: no gradient hero-metric tiles, no big-number/small-label stat template, no endless identical icon-heading-text card grids.
- **Don't** make it read corporate or enterprise: no sterile heavy chrome, no dense toolbar walls.
- **Don't** ship a Notion re-skin: Ledgr is bespoke-first, so a type should not look like a generic database with a coat of paint.
- **Don't** introduce a second brand hue; the accent is the only voice, red is only danger.
- **Don't** put shadows on cards at rest, or use glassmorphism, gradient text, or side-stripe borders (>1px colored left/right accents).
- **Don't** use light gray body text "for elegance" on the dark field; it's the top readability failure here.
- **Don't** hardcode light backgrounds or per-field `color-scheme`; style from tokens so the light theme and per-owner skins flip in one place.
- **Don't** ship an unlabeled bespoke control; every custom affordance gets a clear label or tooltip.
