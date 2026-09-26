// A presentation's look (explorations/presentations.md, design step): theme,
// logo, background, title bar and transition. Stored on the item at
// properties.presentation; the owner's default lives in settings. Pure: this is
// the contract the player, the save route and the exporters all read, and
// `parseDesign` is the trust boundary for anything saved.

export const SIZES = ["s", "m", "l"] as const;
export type Size = (typeof SIZES)[number];
export const THEMES = ["dark", "light", "gray", "sepia"] as const;
export type DesignTheme = (typeof THEMES)[number];
export const CORNERS = ["tl", "tr", "bl", "br"] as const;
export const EFFECTS = ["none", "fade", "fade-black", "fade-up", "fade-down", "wipe-up", "wipe-down", "grow"] as const;
export type Effect = (typeof EFFECTS)[number];
export const SPEEDS = ["fast", "normal", "slow"] as const;

export type PresentationDesign = {
  theme: DesignTheme;
  textColor: string | null; // null = the theme's
  headingColor: string | null;
  logo: { src: string | null; corner: (typeof CORNERS)[number]; margin: Size; size: Size; skip: string };
  background: { color: string | null; image: string | null; darken: number; fullBrightness: string };
  titleBar: { enabled: boolean; text: string; position: "top" | "bottom"; size: Size; margin: Size; skip: string };
  transition: { effect: Effect; speed: (typeof SPEEDS)[number] };
};

// Each theme's slide colors, keyed to Ledgr's own app themes (settings.ts THEMES).
export const THEME_COLORS: Record<DesignTheme, { bg: string; text: string; heading: string }> = {
  dark: { bg: "#000000", text: "#f2f2f2", heading: "#ffffff" },
  light: { bg: "#ffffff", text: "#1f1f1f", heading: "#000000" },
  gray: { bg: "#2b2b2b", text: "#e6e6e6", heading: "#ffffff" },
  sepia: { bg: "#f4ecd8", text: "#3b2f1e", heading: "#2a1f10" },
};

// Logical px on the 1600x900 stage, shared by the player and the exporters.
export const MARGIN_PX: Record<Size, number> = { s: 24, m: 48, l: 80 };
export const LOGO_PX: Record<Size, number> = { s: 80, m: 130, l: 200 };
export const TITLE_PX: Record<Size, number> = { s: 24, m: 32, l: 44 };
export const SPEED_MS: Record<(typeof SPEEDS)[number], number> = { fast: 250, normal: 450, slow: 800 };

export const DEFAULT_DESIGN: PresentationDesign = {
  theme: "dark",
  textColor: null,
  headingColor: null,
  logo: { src: null, corner: "br", margin: "m", size: "m", skip: "" },
  background: { color: null, image: null, darken: 40, fullBrightness: "" },
  titleBar: { enabled: false, text: "", position: "top", size: "m", margin: "m", skip: "" },
  transition: { effect: "fade", speed: "normal" },
};

const HEX = /^#[0-9a-f]{6}$/i;
// Only a Ledgr attachment or an already-inlined image: nothing that makes a
// viewer's browser fetch an arbitrary address.
const IMAGE_SRC = /^(\/files\/[0-9a-f-]{36}(\?[\w=&-]*)?|data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+)$/i;

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}
const color = (v: unknown) => (typeof v === "string" && HEX.test(v) ? v : null);
const image = (v: unknown) => (typeof v === "string" && IMAGE_SRC.test(v) ? v : null);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

// Lenient: anything missing or invalid falls back to the default, so an old or
// hand-edited value can never break the player.
export function parseDesign(raw: unknown, base: PresentationDesign = DEFAULT_DESIGN): PresentationDesign {
  const r = obj(raw), l = obj(r.logo), b = obj(r.background), t = obj(r.titleBar), x = obj(r.transition);
  const darken = Number(b.darken);
  return {
    theme: pick(r.theme, THEMES, base.theme),
    textColor: "textColor" in r ? color(r.textColor) : base.textColor,
    headingColor: "headingColor" in r ? color(r.headingColor) : base.headingColor,
    logo: {
      src: "src" in l ? image(l.src) : base.logo.src,
      corner: pick(l.corner, CORNERS, base.logo.corner),
      margin: pick(l.margin, SIZES, base.logo.margin),
      size: pick(l.size, SIZES, base.logo.size),
      skip: "skip" in l ? text(l.skip, 200) : base.logo.skip,
    },
    background: {
      color: "color" in b ? color(b.color) : base.background.color,
      image: "image" in b ? image(b.image) : base.background.image,
      darken: Number.isFinite(darken) ? Math.round(Math.min(90, Math.max(0, darken))) : base.background.darken,
      fullBrightness: "fullBrightness" in b ? text(b.fullBrightness, 200) : base.background.fullBrightness,
    },
    titleBar: {
      enabled: typeof t.enabled === "boolean" ? t.enabled : base.titleBar.enabled,
      text: "text" in t ? text(t.text, 120) : base.titleBar.text,
      position: pick(t.position, ["top", "bottom"] as const, base.titleBar.position),
      size: pick(t.size, SIZES, base.titleBar.size),
      margin: pick(t.margin, SIZES, base.titleBar.margin),
      skip: "skip" in t ? text(t.skip, 200) : base.titleBar.skip,
    },
    transition: {
      effect: pick(x.effect, EFFECTS, base.transition.effect),
      speed: pick(x.speed, SPEEDS, base.transition.speed),
    },
  };
}

// "1, 5-7" → does it include slide n (1-based)? Junk tokens are ignored.
// ponytail: numbers, not anchors, so an inserted slide shifts them; the
// presenter's numbered slide list is how the owner checks.
export function inSlideList(spec: string, n: number): boolean {
  for (const part of spec.split(",")) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (m && n >= Number(m[1]) && n <= Number(m[2] ?? m[1])) return true;
  }
  return false;
}

export function designColors(d: PresentationDesign) {
  const t = THEME_COLORS[d.theme];
  return { bg: d.background.color ?? t.bg, text: d.textColor ?? t.text, heading: d.headingColor ?? t.heading };
}
