// User Settings form (v5). Every per-owner preference on /settings, sorted into
// eight groups with a section index (the one-page redesign, 2026-09-26). The
// server-rendered blocks (Sign-in, the agent, the calendar feed, API
// credentials) arrive as slots so each lands in its group without this client
// island fetching their data. Each change saves to /api/settings; the accent
// updates the live `--accent` / `--accent-gradient` CSS variables immediately,
// and nav-layout changes router.refresh() so the live nav re-renders without a
// manual reload.
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_GRADIENTS,
  ITEM_OPEN_MODES,
  NAV_POSITIONS,
  NOTIFICATION_KINDS,
  alertStyleFor,
  type AlertStyle,
  notificationEnabled,
  SECTION_STYLES,
  PAGE_WIDTHS,
  COMMENT_DISPLAYS,
  TEXT_SIZES,
  TEXT_SIZE_PX,
  UI_DENSITIES,
  type RailAnchor,
  type SectionStyle,
  type PageWidth,
  type CommentDisplay,
  type TextSize,
  type UiDensity,
  type UserSettings,
  THEMES,
  THEME_LABELS,
} from "@/lib/settings";
import { accentHighlightImageCss } from "@/lib/colors";
import { TOOLBAR_ITEMS } from "@/components/markdown-editor/toolbar-icons";
import NoteEditingPromptActions from "@/components/settings/NoteEditingPromptActions";
import PushDevices from "@/components/settings/PushDevices";

const POSITION_LABELS: Record<UserSettings["navPosition"], string> = {
  top: "Top",
  bottom: "Bottom",
  left: "Left",
  right: "Right",
};

// Where a clicked item opens. "Automatic" names the measured behavior rather than
// hiding it, so the default is a visible choice instead of an unexplained one.
const ITEM_OPEN_LABELS: Record<UserSettings["itemOpenMode"], string> = {
  auto: "Automatic",
  left: "Panel, left",
  right: "Panel, right",
  center: "Popup",
};

const UI_DENSITY_LABELS: Record<UiDensity, string> = {
  compact: "Compact",
  default: "Default",
  comfortable: "Comfortable",
  roomy: "Roomy",
};

const SECTION_STYLE_LABELS: Record<SectionStyle, string> = {
  heavy: "Heavy",
  light: "Light",
  unified: "Unified",
};

const PAGE_WIDTH_LABELS: Record<PageWidth, string> = {
  standard: "Standard",
  wide: "Wide",
  full: "Full",
};

const COMMENT_DISPLAY_LABELS: Record<CommentDisplay, string> = {
  margin: "In the margin",
  icons: "As icons",
};

const TEXT_SIZE_LABELS: Record<TextSize, string> = { sm: "S", base: "M", lg: "L", xl: "XL" };

// The full IANA zone list from the runtime, with a curated fallback for the rare
// engine without Intl.supportedValuesOf. Computed once (module scope).
const ALL_TIMEZONES: string[] = (() => {
  try {
    const sv = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (sv) return sv("timeZone");
  } catch {
    /* fall through */
  }
  return [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Phoenix",
    "America/Los_Angeles",
    "America/Anchorage",
    "Pacific/Honolulu",
    "UTC",
  ];
})();

const INPUT =
  "rounded border border-line bg-surface-2 px-2 py-1 text-sm text-ink outline-none focus:border-line-strong";
const BTN =
  "rounded border border-line-strong px-2 py-1 text-xs text-ink-muted hover:bg-surface-2 disabled:opacity-50";

// One group on the page: an uppercase label the index links to, then its body.
// scroll-mt clears a top nav bar (and the phone's sticky chip row) on a jump.
function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-[calc(var(--nav-pt,0px)+4rem)] flex-col gap-3">
      <h2 className="ui-section-label text-ink-subtle">{title}</h2>
      {children}
    </section>
  );
}

// A group's rows share one card, divided by hairlines.
function Card({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-line rounded-card border border-line bg-surface-1">{children}</div>
  );
}

// The one row pattern: name + help on the left, the control on the right. It
// stacks on a phone, and `stack` keeps wide controls (checkbox grids, the
// dictionary) under the label at every width.
function Row({
  label,
  help,
  stack,
  children,
}: {
  label: string;
  help?: ReactNode;
  stack?: boolean;
  children: ReactNode;
}) {
  return (
    // Flex, not grid: the label keeps at least 16rem and the controls wrap onto
    // their own line when both don't fit, instead of crushing the help text.
    <div
      className={`flex gap-x-6 gap-y-2 px-4 py-3.5 ${
        stack ? "flex-col" : "flex-wrap items-center justify-between"
      }`}
    >
      <div className={stack ? "min-w-0" : "min-w-0 flex-1 basis-64"}>
        <p className="ui-row font-medium">{label}</p>
        {help && <div className="mt-0.5 max-w-prose text-xs text-ink-subtle">{help}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

// The one choice-of-N control: a segmented bar.
function Seg<T extends string>({
  options,
  value,
  label,
  onChange,
}: {
  options: readonly T[];
  value: T | null;
  label: (v: T) => string;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap rounded-md border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={value === o}
          onClick={() => onChange(o)}
          className={`rounded px-2.5 py-1 text-xs ${
            value === o
              ? "bg-surface-0 text-ink shadow-[0_0_0_1px_var(--color-line-strong)]"
              : "text-ink-muted hover:text-ink"
          }`}
        >
          {label(o)}
        </button>
      ))}
    </div>
  );
}

// A checkbox list for "which of these show" settings (a hidden-ids array).
function ShownChecks({
  items,
  hidden,
  onChange,
  cols = "sm:grid-cols-3",
}: {
  items: readonly { id: string; label: string }[];
  hidden: string[];
  onChange: (hidden: string[]) => void;
  cols?: string;
}) {
  return (
    <div className={`grid w-full grid-cols-2 gap-x-6 gap-y-1.5 ${cols}`}>
      {items.map((it) => (
        <label key={it.id} className="flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={!hidden.includes(it.id)}
            onChange={() => {
              const set = new Set(hidden);
              if (set.has(it.id)) set.delete(it.id);
              else set.add(it.id);
              onChange([...set]);
            }}
            className="ledgr-check"
          />
          {it.label}
        </label>
      ))}
    </div>
  );
}

export default function SettingsForm({
  initial,
  serverDefaultTz,
  notificationsOn,
  liveContextOn,
  signin,
  agent,
  icsFeed,
  apiCredentials,
}: {
  initial: UserSettings;
  // Module switches resolved on the server (Build → Modules, ADR-272), so this
  // client form never re-implements the "switch, else default" rule.
  notificationsOn: boolean;
  liveContextOn: boolean;
  // The zone "Automatic" falls back to (the LEDGR_TIMEZONE env, else
  // America/New_York), shown in the label so the default is legible.
  serverDefaultTz: string;
  // Server-rendered blocks, placed into their groups (null when not offered here).
  signin: ReactNode;
  agent: ReactNode;
  icsFeed: ReactNode;
  apiCredentials: ReactNode;
}) {
  const [settings, setSettings] = useState<UserSettings>(initial);
  const [status, setStatus] = useState<"saved" | "failed" | null>(null);
  const [trashDays, setTrashDays] = useState(String(initial.trashRetentionDays));
  const router = useRouter();

  // The search dictionary (ADR-172) is stored as word -> [synonyms], but edited as
  // rows of text so the word itself stays editable without key-collision
  // weirdness mid-keystroke. Serialized back to the record on commit, where
  // blank/synonym-less rows simply drop out (parseSearchSynonyms would drop them
  // anyway; doing it here keeps the saved blob clean).
  const [dictRows, setDictRows] = useState<{ word: string; synonyms: string }[]>(() =>
    Object.entries(initial.searchSynonyms).map(([word, syns]) => ({
      word,
      synonyms: syns.join(", "),
    }))
  );
  const commitDict = (rows: { word: string; synonyms: string }[]) => {
    const next: Record<string, string[]> = {};
    for (const row of rows) {
      const word = row.word.trim().toLowerCase();
      const synonyms = row.synonyms
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (word && synonyms.length > 0) next[word] = synonyms;
    }
    void save({ searchSynonyms: next });
  };
  const setDictRow = (i: number, patch: Partial<{ word: string; synonyms: string }>) =>
    setDictRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const saveDict = () => commitDict(dictRows);

  // Timezone drives every "today" boundary and the wall-clock of every displayed
  // time. Server surfaces render it, so a change router.refresh()es to take hold.
  const setTimezone = (tz: string | null) => {
    setSettings((s) => ({ ...s, timezone: tz }));
    void save({ timezone: tz }, true);
  };
  // Ensure the currently-saved zone is always selectable even if the runtime's
  // list somehow omits it (a hand-set value, an older list).
  const zoneOptions =
    settings.timezone && !ALL_TIMEZONES.includes(settings.timezone)
      ? [settings.timezone, ...ALL_TIMEZONES]
      : ALL_TIMEZONES;

  const isRail = settings.navPosition === "left" || settings.navPosition === "right";

  // Push the chosen accent to the live CSS vars: `--accent` is always a solid
  // (so text/borders/glows stay valid); `--accent-gradient` is the gradient when
  // one is picked, else the same solid.
  //
  // `--accent-highlight-image` has to move with them (ADR-250). It is the image
  // channel of the accent highlight, and for a GRADIENT accent it is the only
  // layer you can actually see, painting over the `background-color` underneath.
  // Leaving it out here is what made changing your accent look like it did
  // nothing: `--accent` updated instantly, the highlight kept the gradient the
  // server wrote at page load, and it only corrected on a full reload. These
  // three vars are one setting; they get written together or the highlight lies.
  const applyAccent = (color: string, gradient: string | null) => {
    document.body.style.setProperty("--accent", color);
    document.body.style.setProperty("--accent-gradient", gradient ?? color);
    document.body.style.setProperty(
      "--accent-highlight-image",
      gradient ? accentHighlightImageCss(gradient) : "none"
    );
  };

  const applyTextSize = (size: TextSize) => {
    document.body.style.setProperty("--prose-font-size", TEXT_SIZE_PX[size]);
  };

  // The section style is a body attribute the CanvasSection CSS reads, so setting
  // it re-skins every item-canvas panel live, no reload.
  const applySectionStyle = (style: SectionStyle) => {
    document.body.setAttribute("data-section-style", style);
  };

  // Show "Saved" only when the server said yes. A refused or dropped request
  // says so, instead of the old pill that claimed success either way.
  const save = async (patch: Partial<UserSettings>, refresh = false) => {
    setSettings((s) => ({ ...s, ...patch }));
    let ok = false;
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      ok = res.ok;
    } catch {
      /* offline; reported below */
    }
    setStatus(ok ? "saved" : "failed");
    setTimeout(() => setStatus(null), ok ? 1200 : 4000);
    // Nav layout is rendered server-side (Nav → NavShell); refresh so a
    // position/spacing change shows up live, matching the More-menu behavior.
    if (ok && refresh) router.refresh();
  };

  // Trash retention saves when you leave the box, so typing "45" doesn't save 4
  // first, and an empty or out-of-range entry snaps back to the saved value.
  const commitTrashDays = () => {
    const n = Math.round(Number(trashDays));
    if (!Number.isFinite(n) || n < 1 || n > 365) {
      setTrashDays(String(settings.trashRetentionDays));
      return;
    }
    setTrashDays(String(n));
    if (n !== settings.trashRetentionDays) void save({ trashRetentionDays: n });
  };

  const setSpacing = (density: "spread" | "compact", anchor?: RailAnchor) =>
    void save(
      { navDensity: density, ...(anchor ? { railAnchor: anchor } : {}) },
      true
    );
  const spacingValue =
    settings.navDensity === "spread" ? "spread" : (settings.railAnchor as RailAnchor);
  const SPACING_OPTIONS = ["spread", "top", "center", "bottom"] as const;
  const spacingLabel = (v: (typeof SPACING_OPTIONS)[number]) =>
    v === "spread"
      ? "Spread"
      : v === "center"
        ? "Center"
        : isRail
          ? v === "top" ? "Top" : "Bottom"
          : v === "top" ? "Left" : "Right";

  const groups: { id: string; title: string; show: boolean }[] = [
    { id: "account", title: "Account", show: true },
    { id: "appearance", title: "Appearance", show: true },
    { id: "layout", title: "Layout", show: true },
    { id: "editing", title: "Editing", show: true },
    { id: "search", title: "Search", show: true },
    { id: "notifications", title: "Notifications", show: notificationsOn },
    { id: "ai", title: "AI", show: true },
    { id: "connections", title: "Connections & data", show: true },
  ];
  const shown = groups.filter((g) => g.show);

  // Light up the index entry for the group at the top of the screen.
  const [active, setActive] = useState(shown[0].id);
  useEffect(() => {
    const els = shown
      .map((g) => document.getElementById(g.id))
      .filter((el): el is HTMLElement => !!el);
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: "-10% 0px -70% 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notificationsOn]);

  return (
    <div className="mt-6 grid gap-8 lg:grid-cols-[11rem_minmax(0,1fr)]">
      {/* The section index: a sticky column on wide screens, a sticky row of
          chips across the top on a phone. Plain anchors, so /settings#layout
          and the command palette land on the right group. */}
      <nav
        aria-label="Settings sections"
        className="no-scrollbar sticky top-[var(--nav-pt,0px)] z-10 -mx-6 flex gap-1.5 overflow-x-auto bg-surface-0 px-6 py-2 sm:-mx-12 sm:px-12 lg:mx-0 lg:flex-col lg:self-start lg:overflow-visible lg:bg-transparent lg:px-0 lg:pt-1"
      >
        {shown.map((g) => (
          <a
            key={g.id}
            href={`#${g.id}`}
            onClick={() => setActive(g.id)}
            aria-current={active === g.id ? "true" : undefined}
            className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-sm lg:rounded-md lg:border-0 lg:px-2 lg:py-1.5 ${
              active === g.id
                ? "border-line-strong bg-surface-2 text-ink"
                : "border-line text-ink-muted hover:bg-surface-2 hover:text-ink"
            }`}
          >
            {g.title}
          </a>
        ))}
      </nav>

      <div className="flex min-w-0 flex-col gap-10">
        <Group id="account" title="Account">
          <Card>
            <Row
              label="Display name"
              help="Shown wherever your name appears in the app. Leave blank to use your email name."
            >
              <input
                type="text"
                maxLength={60}
                placeholder="Your name"
                aria-label="Display name"
                value={settings.displayName}
                onChange={(e) => setSettings({ ...settings, displayName: e.target.value })}
                onBlur={() => void save({ displayName: settings.displayName })}
                className={`${INPUT} w-48`}
              />
            </Row>
            <Row
              label="Timezone"
              help="Sets what “today” means and the clock times shown throughout the app (meetings, due dates, timestamps). Traveling doesn’t change it, so your times stay put wherever you are."
            >
              <select
                value={settings.timezone ?? ""}
                aria-label="Timezone"
                onChange={(e) => setTimezone(e.target.value || null)}
                className={`${INPUT} w-56`}
              >
                <option value="">Automatic ({serverDefaultTz})</option>
                {zoneOptions.map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  try {
                    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
                    if (detected) setTimezone(detected);
                  } catch {
                    /* leave the current value */
                  }
                }}
                className={BTN}
              >
                Use this device&apos;s timezone
              </button>
            </Row>
          </Card>
          {signin}
        </Group>

        <Group id="appearance" title="Appearance">
          <Card>
            <Row
              label="Theme"
              help="The app’s overall look. Applies everywhere you’re signed in, and new share links open in this theme by default."
            >
              <Seg
                options={THEMES}
                value={settings.theme}
                label={(t) => THEME_LABELS[t]}
                onChange={(t) => void save({ theme: t }, true)}
              />
            </Row>
            <Row
              label="Highlight color"
              help="The accent used for primary buttons and highlights. Gradients fill checkboxes and count badges; text and borders use a matching solid tone."
              stack
            >
              <div className="flex flex-wrap items-center gap-2">
                {HIGHLIGHT_COLORS.map((c) => {
                  const selected = !settings.highlightGradient && settings.highlightColor === c.value;
                  return (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => {
                        applyAccent(c.value, null);
                        void save({ highlightColor: c.value, highlightGradient: null });
                      }}
                      aria-label={c.name}
                      aria-pressed={selected}
                      title={c.name}
                      className={`h-7 w-7 rounded-full border-2 ${selected ? "border-ink" : "border-transparent"}`}
                      style={{ background: c.value }}
                    />
                  );
                })}
                <span aria-hidden className="mx-1 h-5 w-px bg-line-strong" />
                {HIGHLIGHT_GRADIENTS.map((g) => {
                  const selected = settings.highlightGradient === g.value;
                  return (
                    <button
                      key={g.value}
                      type="button"
                      onClick={() => {
                        applyAccent(g.accent, g.value);
                        void save({ highlightColor: g.accent, highlightGradient: g.value });
                      }}
                      aria-label={`${g.name} gradient`}
                      aria-pressed={selected}
                      title={`${g.name} gradient`}
                      className={`h-7 w-7 rounded-full border-2 ${selected ? "border-ink" : "border-transparent"}`}
                      style={{ background: g.value }}
                    />
                  );
                })}
              </div>
            </Row>
            <Row label="Text size" help="Font size for the reading and editing canvas.">
              <Seg
                options={TEXT_SIZES}
                value={settings.textSize}
                label={(s) => TEXT_SIZE_LABELS[s]}
                onChange={(s) => {
                  applyTextSize(s);
                  void save({ textSize: s });
                }}
              />
            </Row>
            <Row
              label="Display density"
              help="How much space the whole interface uses. Menus, buttons, titles, and spacing all scale together. Set desktop and mobile separately."
              stack
            >
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-14 ui-meta">Desktop</span>
                  <Seg
                    options={UI_DENSITIES}
                    value={settings.uiDensity}
                    label={(d) => UI_DENSITY_LABELS[d]}
                    onChange={(d) => void save({ uiDensity: d }, true)}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-14 ui-meta">Mobile</span>
                  <Seg
                    options={["same", ...UI_DENSITIES] as const}
                    value={settings.mobileUiDensity ?? "same"}
                    label={(d) => (d === "same" ? "Same as desktop" : UI_DENSITY_LABELS[d])}
                    onChange={(d) => void save({ mobileUiDensity: d === "same" ? null : d }, true)}
                  />
                </div>
              </div>
            </Row>
            <Row
              label="Section style"
              help="How much weight each panel on an item view carries (People, Open tasks, Properties, Linked here). Heavy is bordered cards; Light is a divider rule; Unified is flat."
            >
              <Seg
                options={SECTION_STYLES}
                value={settings.sectionStyle}
                label={(s) => SECTION_STYLE_LABELS[s]}
                onChange={(s) => {
                  applySectionStyle(s);
                  void save({ sectionStyle: s });
                }}
              />
            </Row>
            <Row
              label="Page width"
              help="How wide an item's page runs, on the full page and in Desk panels. Standard is a comfortable reading column; Wide and Full use more of a big monitor."
            >
              <Seg
                options={PAGE_WIDTHS}
                value={settings.pageWidth}
                label={(w) => PAGE_WIDTH_LABELS[w]}
                onChange={(w) => {
                  document.body.setAttribute("data-page-width", w);
                  void save({ pageWidth: w });
                }}
              />
            </Row>
            <Row
              label="Comments"
              help="In the margin shows each comment as a card beside the text on a wide screen, which narrows the text. As icons shows a small speech bubble in the text instead: hover it to read the note, click it to edit."
            >
              <Seg
                options={COMMENT_DISPLAYS}
                value={settings.commentDisplay}
                label={(d) => COMMENT_DISPLAY_LABELS[d]}
                onChange={(d) => {
                  document.body.setAttribute("data-comments", d);
                  void save({ commentDisplay: d });
                }}
              />
            </Row>
          </Card>
        </Group>

        <Group id="layout" title="Layout">
          <Card>
            <Row label="Navigation position" help="Where the nav bar sits.">
              <Seg
                options={NAV_POSITIONS}
                value={settings.navPosition}
                label={(p) => POSITION_LABELS[p]}
                onChange={(p) => void save({ navPosition: p }, true)}
              />
            </Row>
            {/* The bottom bar is always compact, so it offers no spacing choice. */}
            {settings.navPosition !== "bottom" && (
              <Row
                label="Spacing"
                help="Spread the slots across the bar, or group them and anchor the cluster."
              >
                <Seg
                  options={SPACING_OPTIONS}
                  value={spacingValue}
                  label={spacingLabel}
                  onChange={(v) => (v === "spread" ? setSpacing("spread") : setSpacing("compact", v))}
                />
              </Row>
            )}
            {/* Sits after nav position because the two interact: a docked rail
                owns its edge, so a left rail plus a left panel falls back to the
                free edge. The note names the collision (ADR-179). */}
            <Row
              label="Opening an item"
              help={
                <>
                  Where an item opens when you click it from a list. Automatic docks a panel on
                  wide screens and uses the popup otherwise. A phone always uses the bottom sheet.
                  {(settings.itemOpenMode === "left" || settings.itemOpenMode === "right") &&
                    settings.navPosition === settings.itemOpenMode && (
                      <span className="mt-1 block text-amber-400/80">
                        Your nav rail is docked {settings.itemOpenMode}, so the panel opens on the
                        opposite edge instead.
                      </span>
                    )}
                </>
              }
            >
              <Seg
                options={ITEM_OPEN_MODES}
                value={settings.itemOpenMode}
                label={(m) => ITEM_OPEN_LABELS[m]}
                onChange={(m) => void save({ itemOpenMode: m }, true)}
              />
            </Row>
          </Card>
        </Group>

        <Group id="editing" title="Editing">
          <Card>
            {/* Quick Add chips live with each type on Build → Types (ADR-268),
                task's built-in chips included; this row only points there. */}
            <Row
              label="Quick-add card"
              help="Which chips show on the quick-add card is set per type, on each type's row in Build → Types."
            >
              <a href="/build/types" className={BTN}>
                Open Types
              </a>
            </Row>
            <Row
              label="Editor toolbar"
              help="Which buttons show in the markdown editor toolbar on every canvas. Takes effect on the next page load."
              stack
            >
              <ShownChecks
                items={TOOLBAR_ITEMS}
                hidden={settings.editorToolbarHidden}
                onChange={(h) => void save({ editorToolbarHidden: h })}
              />
            </Row>
            <Row
              label="Collapsible headings"
              help="A fold arrow on each heading hides or shows the section beneath it. Collapsed sections are remembered on this device only; nothing changes in the saved note. Takes effect on the next page load."
            >
              <input
                type="checkbox"
                aria-label="Collapsible headings"
                checked={settings.collapsibleHeadingsEnabled}
                onChange={(e) => void save({ collapsibleHeadingsEnabled: e.target.checked })}
                className="ledgr-check"
              />
            </Row>
            <Row
              label="Collapsible bullets"
              help="A fold arrow on any bullet, numbered, or checklist item with something nested under it hides everything beneath that item. Click the arrow or the bullet itself. Collapsed items are remembered on this device only; nothing changes in the saved note. Takes effect on the next page load."
            >
              <input
                type="checkbox"
                aria-label="Collapsible bullets"
                checked={settings.collapsibleListsEnabled}
                onChange={(e) => void save({ collapsibleListsEnabled: e.target.checked })}
                className="ledgr-check"
              />
            </Row>
            <Row
              label="Toggle blocks"
              help={
                <>
                  Insert a collapsible block (a summary line that expands to reveal content) from
                  the toolbar or the{" "}
                  <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[11px] text-ink-muted">
                    /toggle
                  </code>{" "}
                  slash command. A toggle remembers whether it&apos;s open or closed as part of the note,
                  so it looks the same on every device. Existing toggles still show when this is
                  off. Takes effect on the next page load.
                </>
              }
            >
              <input
                type="checkbox"
                aria-label="Toggle blocks"
                checked={settings.toggleBlocksEnabled}
                onChange={(e) => void save({ toggleBlocksEnabled: e.target.checked })}
                className="ledgr-check"
              />
            </Row>
          </Card>
        </Group>

        {/* The owner's personal search dictionary (ADR-172). Fuzzy search already
            expands a word through WordNet, which knows English but not Edgewood —
            it will not connect "teaching" to "preaching", or know that "message"
            means a sermon here. This is the fix, and it's meant to stay small:
            add a line only when a search actually misses. */}
        <Group id="search" title="Search">
          <Card>
            <Row
              label="Search dictionary"
              help="Extra words fuzzy search should treat as matches for each other. General English synonyms are already built in, so this is for your own vocabulary. Add one when a search misses something you knew was there."
              stack
            >
              <div className="flex w-full flex-col gap-1.5">
                {dictRows.map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      maxLength={60}
                      placeholder="teaching"
                      aria-label="Word"
                      value={row.word}
                      onChange={(e) => setDictRow(i, { word: e.target.value })}
                      onBlur={saveDict}
                      className={`${INPUT} w-32 shrink-0`}
                    />
                    <span className="shrink-0 text-xs text-ink-faint">also matches</span>
                    <input
                      type="text"
                      placeholder="preaching, message, lesson"
                      aria-label="Synonyms, comma separated"
                      value={row.synonyms}
                      onChange={(e) => setDictRow(i, { synonyms: e.target.value })}
                      onBlur={saveDict}
                      className={`${INPUT} min-w-0 flex-1`}
                    />
                    <button
                      type="button"
                      aria-label="Remove this entry"
                      onClick={() => {
                        const next = dictRows.filter((_, j) => j !== i);
                        setDictRows(next);
                        commitDict(next);
                      }}
                      className="rounded px-1.5 text-ink-faint hover:bg-surface-2 hover:text-ink-muted"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setDictRows((prev) => [...prev, { word: "", synonyms: "" }])}
                  className="w-fit rounded border border-dashed border-line-strong px-2 py-1 text-xs text-ink-subtle hover:bg-surface-2 hover:text-ink-muted"
                >
                  + Add a word
                </button>
              </div>
            </Row>
          </Card>
        </Group>

        {/* Notification center paused (ADR-130): the per-source toggles show only
            while the notification-center module is on (Build → Modules). */}
        {notificationsOn && (
          <Group id="notifications" title="Notifications">
            <Card>
              {NOTIFICATION_KINDS.map(({ kind, label, help }) => (
                <Row key={kind} label={label} help={help}>
                  <select
                    aria-label={`${label}: how it shows while Ledgr is open`}
                    title="How it shows while Ledgr is open"
                    value={alertStyleFor(settings.alertStyles, kind)}
                    disabled={!notificationEnabled(settings.notificationPrefs, kind)}
                    onChange={(e) =>
                      void save({
                        alertStyles: { ...settings.alertStyles, [kind]: e.target.value as AlertStyle },
                      })
                    }
                    className={INPUT}
                  >
                    <option value="quiet">Quiet</option>
                    <option value="toast">Pop-up</option>
                    <option value="banner">Banner</option>
                  </select>
                  <input
                    type="checkbox"
                    aria-label={label}
                    checked={notificationEnabled(settings.notificationPrefs, kind)}
                    onChange={(e) =>
                      void save({
                        notificationPrefs: {
                          ...settings.notificationPrefs,
                          [kind]: e.target.checked,
                        },
                      })
                    }
                    className="ledgr-check"
                  />
                </Row>
              ))}
              <Row
                label="Alerts while Ledgr is open"
                help="Quiet shows only on the bell and the browser tab. Pop-up slides a card into the corner that fades after a few seconds. Banner stays across the top until you open, snooze, or dismiss it."
              >
                <label className="flex items-center gap-2 text-sm text-ink-muted">
                  <input
                    type="checkbox"
                    checked={settings.alertSound}
                    onChange={(e) => void save({ alertSound: e.target.checked })}
                    className="ledgr-check"
                  />
                  Play a sound
                </label>
              </Row>
            </Card>
            <Card>
              <PushDevices />
            </Card>
          </Group>
        )}

        <Group id="ai" title="AI">
          <Card>
            <Row
              label="AI features"
              help="AI Memory, live editing context, the in-app agent and YouTube transcripts are turned on and off in Build → Modules. Their options stay here."
            >
              <a href="/build/modules" className={BTN}>
                Open Modules
              </a>
            </Row>
            {liveContextOn && (
              <Row
                label="Note Editing Partner prompt"
                help="The instructions Claude follows while you edit a note."
              >
                <NoteEditingPromptActions />
              </Row>
            )}
          </Card>
          {agent}
        </Group>

        <Group id="connections" title="Connections & data">
          <Card>
            <Row label="Trash retention" help="Days a trashed item is kept before it is purged.">
              <input
                type="number"
                min={1}
                max={365}
                aria-label="Trash retention in days"
                value={trashDays}
                onChange={(e) => setTrashDays(e.target.value)}
                onBlur={commitTrashDays}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                className={`${INPUT} w-20`}
              />
              <span className="ui-meta">days</span>
            </Row>
          </Card>
          {icsFeed}
          {apiCredentials}
        </Group>
      </div>

      {/* Floating, not inline: the form is long, so an inline confirmation is
          invisible when you change a control mid-page. */}
      {status && (
        <p
          role="status"
          className={`fixed bottom-4 right-4 z-50 rounded-md bg-surface-3 px-3 py-1.5 text-xs shadow-lg ring-1 ${
            status === "saved" ? "text-ink ring-line-strong" : "text-red-300 ring-red-800"
          }`}
        >
          {status === "saved" ? "Saved" : "Couldn’t save that change. Check your connection and try again."}
        </p>
      )}
    </div>
  );
}
