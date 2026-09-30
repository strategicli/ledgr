// The Website Pages design system, ported from Claude Design's `ledgr-theme.js`
// (project "Ledgr Design System", 2026-09-28). A page's look is three choices,
// stored as page settings (properties.design), never in the markdown:
//   language  how it's built: corners, heading weight and case, cards, hero
//   palette   lead / support / highlight / background, light and dark
//   font      one family (each language has a default)
// Each language is a set of CSS variables and every block in page-html.ts reads
// them, which is what lets any starter render in any language. Pure.

export type Mode = "light" | "dark";
type Swatch = { lead: string; support: string; hl: string; bg: string };

export const PALETTES: Record<string, { name: string; why: string; light: Swatch; dark: Swatch }> = {
  slate: {
    name: "Slate",
    why: "Blue lead, steel-gray support, a bright sky highlight. Clear and trustworthy; fits almost anything.",
    light: { lead: "#2f5fd0", support: "#4f5f78", hl: "#2fa9dc", bg: "#f5f7fa" },
    dark: { lead: "#7ea2ff", support: "#a7b4c8", hl: "#6fd0f5", bg: "#10141a" },
  },
  navy: {
    name: "Navy",
    why: "Deep navy lead, sky-blue support, a coral highlight. Established and serious, with some warmth.",
    light: { lead: "#1d3b66", support: "#2f6fae", hl: "#e0674f", bg: "#f4f6f9" },
    dark: { lead: "#8fb4ea", support: "#6aaee8", hl: "#ff8a73", bg: "#0b1220" },
  },
  forest: {
    name: "Forest",
    why: "Deep green lead, moss support, a sunflower highlight. Calm, grounded and outdoorsy.",
    light: { lead: "#2f6b4f", support: "#5b7a2e", hl: "#e3b341", bg: "#f5f7f2" },
    dark: { lead: "#6fcf9c", support: "#a9c77a", hl: "#f0c75e", bg: "#0f1511" },
  },
  dusk: {
    name: "Dusk",
    why: "Indigo lead, periwinkle support, a peach highlight. Calm and a little evening-like; reflective without feeling heavy.",
    light: { lead: "#3a3d8f", support: "#5b6ab8", hl: "#f0a36b", bg: "#f6f6fb" },
    dark: { lead: "#a3a8ff", support: "#9fb0ef", hl: "#ffb98a", bg: "#10111c" },
  },
  // Claude Design's fifth palette, kept by Tyler 2026-09-29.
  tide: {
    name: "Tide",
    why: "Deep sea-teal with a soft rose highlight. Cool like Slate and Navy, but with no blue, and not as earthy as Forest.",
    light: { lead: "#0f6b6f", support: "#4f7a80", hl: "#e46f8a", bg: "#f3f7f7" },
    dark: { lead: "#5fd0cf", support: "#9cc2c6", hl: "#ff9bb0", bg: "#0c1516" },
  },
};

export const FONTS: Record<string, { name: string; stack: string; why: string }> = {
  public: {
    name: "Public Sans",
    stack: "'Public Sans', system-ui, sans-serif",
    why: "Plain-spoken and very readable, built to be clear to everyone. The default.",
  },
  helvetica: {
    name: "Helvetica",
    stack: "'Helvetica Neue', Helvetica, Arial, sans-serif",
    why: "The classic neutral. Loads nothing: real Helvetica on Apple devices, Arial elsewhere.",
  },
  montserrat: {
    name: "Montserrat",
    stack: "'Montserrat', system-ui, sans-serif",
    why: "Wide and geometric, strong in big headlines.",
  },
  figtree: {
    name: "Figtree",
    stack: "'Figtree', system-ui, sans-serif",
    why: "Rounded and friendly without being childish.",
  },
  serif: {
    name: "Source Serif 4",
    stack: "'Source Serif 4', Georgia, serif",
    why: "Bookish and trustworthy. Best for long reading.",
  },
};

type Vars = Record<string, string>;

const BASE: Vars = {
  "--pad": "clamp(20px, 5.2cqi, 64px)", "--gap-y": "clamp(56px, 9cqi, 104px)", "--h3": "clamp(18px, 2.1cqi, 22px)",
  "--label-size": "12px", "--lede-size": "clamp(18px, 2.2cqi, 21px)", "--lede-style": "normal", "--hero-max": "var(--wide)",
  "--hero-txt-p": "0", "--hero-txt-m": "0", "--hero-justify": "flex-start", "--hero-muted": "var(--muted)",
  "--hero-label": "var(--label-c)", "--hero-btn-bg": "var(--lead)", "--hero-btn-ink": "var(--on-lead)",
  "--hero-btn2-bd": "color-mix(in oklab, var(--hero-ink) 30%, transparent)", "--tag-ink": "var(--ink)", "--tag-size": "14px",
  "--tag-track": "0", "--tl-ytrack": "0", "--tl-ybg": "transparent", "--tl-yp": "0", "--tl-yr": "0", "--dc-float": "none",
  "--dc-size": "1em", "--dc-lh": "1", "--dc-w": "400", "--dc-m": "0", "--dc-c": "currentColor", "--btn-size": "15px",
  "--btn-track": "0", "--btn-case": "none", "--cta-bw": "0", "--cta-bc": "transparent", "--cta-btn-bg": "var(--lead)",
  "--cta-btn-ink": "var(--on-lead)", "--cta-muted": "var(--muted)", "--cta-dir": "row", "--cta-items": "center",
  "--cta-align": "left", "--nav-bd": "0", "--dot-r": "50%", "--play-r": "50%", "--quote-size": "clamp(24px, 3.4cqi, 34px)",
  "--quote-style": "normal", "--quote-align": "left", "--quote-bw": "0", "--quote-bc": "transparent",
  "--num-size": "clamp(40px, 6cqi, 64px)",
};

export const LANGUAGES: Record<string, { name: string; font: string; diff: string; when: string; v: Vars }> = {
  modern: {
    name: "Modern", font: "public",
    diff: "Soft 14px corners, heavy tight headings, white cards floating on tinted bands, image beside the headline.",
    when: "You want a confident, current page that shows work at a glance: portfolios, ministries, launches.",
    v: {
      "--col": "1080px", "--wide": "1080px", "--h-w": "800", "--h-track": "-0.035em", "--h-case": "none", "--h-lh": "1.02",
      "--h1": "clamp(38px, 6.2cqi, 70px)", "--h2": "clamp(26px, 3.4cqi, 40px)",
      "--label-w": "700", "--label-track": "0.06em", "--label-case": "uppercase", "--label-c": "var(--lead)",
      "--r": "14px", "--img-r": "10px", "--card-bg": "var(--surface)", "--card-bd": "0", "--card-bt": "0",
      "--card-p": "clamp(16px, 2.2cqi, 22px)", "--card-sh": "0 1px 2px rgb(10 20 40 / .05), 0 10px 28px -14px rgb(10 20 40 / .22)",
      "--band-bg": "var(--tint)", "--sec-rule": "0", "--sec-pt": "0",
      "--btn-r": "10px", "--btn-p": "13px 22px", "--btn-w": "700",
      "--hero-outer-p": "0", "--hero-bg": "var(--tint)", "--hero-ink": "var(--ink)", "--hero-r": "0",
      "--hero-p": "clamp(40px, 7cqi, 96px) var(--pad)", "--hero-txt-basis": "360px", "--hero-img-basis": "320px",
      "--hero-img-order": "1", "--hero-img-h": "clamp(260px, 38cqi, 440px)", "--hero-img-r": "16px", "--hero-align": "left",
      "--hero-txt-max": "560px",
      "--co-bg": "var(--lead-tint)", "--co-ink": "var(--ink)", "--co-bw": "0", "--co-bc": "transparent", "--co-r": "14px",
      "--co-p": "clamp(22px, 3cqi, 32px)", "--co-align": "left", "--co-style": "normal", "--co-size": "clamp(18px, 2.2cqi, 22px)", "--co-w": "650",
      "--tl-cols": "minmax(64px, 120px) 1fr", "--tl-ys": "14px", "--tl-yw": "800", "--tl-yc": "var(--lead)", "--tl-dot": "block", "--tl-rule": "0",
      "--tag-bg": "var(--surface)", "--tag-bd": "1px solid var(--line)", "--tag-r": "8px", "--tag-p": "7px 12px", "--tag-case": "none", "--tag-w": "600",
      "--av-r": "16px", "--cta-bg": "var(--lead)", "--cta-ink": "var(--on-lead)",
      "--cta-muted": "color-mix(in oklab, var(--on-lead) 80%, var(--lead))", "--cta-btn-bg": "var(--on-lead)", "--cta-btn-ink": "var(--lead)",
      "--cta-r": "16px", "--cta-p": "clamp(28px, 4cqi, 48px)", "--quote-bw": "0 0 0 0",
    },
  },
  minimal: {
    name: "Minimal", font: "public",
    diff: "Square edges, medium weights and hairline rules instead of boxes. The white space does most of the work.",
    when: "The content can stand on its own: résumés, reading lists, documentation.",
    v: {
      "--col": "880px", "--wide": "1000px", "--gap-y": "clamp(64px, 11cqi, 128px)", "--h-w": "500", "--h-track": "-0.02em",
      "--h-case": "none", "--h-lh": "1.1", "--h1": "clamp(34px, 5.2cqi, 58px)", "--h2": "clamp(24px, 3cqi, 34px)",
      "--label-w": "500", "--label-track": "0.14em", "--label-case": "uppercase", "--label-c": "var(--muted)", "--label-size": "11px",
      "--r": "0", "--img-r": "0", "--card-bg": "transparent", "--card-bd": "0", "--card-bt": "1px solid var(--line)",
      "--card-p": "20px 0 0", "--card-sh": "none",
      "--band-bg": "transparent", "--sec-rule": "1px solid var(--line)", "--sec-pt": "20px",
      "--btn-r": "0", "--btn-p": "11px 18px", "--btn-w": "500",
      "--hero-outer-p": "0", "--hero-bg": "transparent", "--hero-ink": "var(--ink)", "--hero-r": "0",
      "--hero-p": "clamp(20px, 3.4cqi, 40px) var(--pad) clamp(32px, 5cqi, 56px)", "--hero-txt-basis": "100%",
      "--hero-img-basis": "100%", "--hero-img-order": "-1", "--hero-img-h": "clamp(120px, 15cqi, 176px)", "--hero-img-r": "0",
      "--hero-align": "left", "--hero-txt-max": "720px",
      "--co-bg": "transparent", "--co-ink": "var(--ink)", "--co-bw": "1px 0", "--co-bc": "var(--line)", "--co-r": "0",
      "--co-p": "26px 0", "--co-align": "left", "--co-style": "normal", "--co-size": "clamp(18px, 2.2cqi, 22px)", "--co-w": "450",
      "--tl-cols": "minmax(64px, 160px) 1fr", "--tl-ys": "14px", "--tl-yw": "500", "--tl-yc": "var(--muted)", "--tl-dot": "none",
      "--tl-rule": "1px solid var(--line)",
      "--tag-bg": "transparent", "--tag-bd": "1px solid var(--line)", "--tag-r": "0", "--tag-p": "5px 10px", "--tag-case": "none", "--tag-w": "500",
      "--av-r": "0", "--nav-bd": "1px solid var(--line)", "--dot-r": "0", "--play-r": "0",
      "--cta-bg": "transparent", "--cta-ink": "var(--ink)", "--cta-bw": "1px 0", "--cta-bc": "var(--line)", "--cta-r": "0", "--cta-p": "36px 0",
      "--quote-size": "clamp(22px, 3cqi, 30px)", "--quote-bw": "1px 0", "--quote-bc": "var(--line)", "--num-size": "clamp(36px, 5cqi, 52px)",
    },
  },
  bold: {
    name: "Bold", font: "montserrat",
    diff: "Poster energy: uppercase extra-bold headings, full-width color and near-square blocks.",
    when: "One message has to land from across the room: events, campaigns, project wins.",
    v: {
      "--col": "1120px", "--wide": "1120px", "--h-w": "900", "--h-track": "-0.01em", "--h-case": "uppercase", "--h-lh": "0.96",
      "--h1": "clamp(40px, 7.4cqi, 92px)", "--h2": "clamp(28px, 4.2cqi, 50px)", "--h3": "clamp(17px, 1.9cqi, 20px)",
      "--label-w": "800", "--label-track": "0.1em", "--label-case": "uppercase", "--label-c": "var(--lead)",
      "--r": "3px", "--img-r": "2px", "--card-bg": "var(--surface)", "--card-bd": "2px solid var(--ink)", "--card-bt": "2px solid var(--ink)",
      "--card-p": "18px", "--card-sh": "none",
      "--band-bg": "var(--lead-tint)", "--sec-rule": "5px solid var(--ink)", "--sec-pt": "16px",
      "--btn-r": "2px", "--btn-p": "15px 24px", "--btn-w": "800", "--btn-case": "uppercase", "--btn-track": "0.06em", "--btn-size": "14px",
      "--hero-outer-p": "0", "--hero-bg": "var(--lead)", "--hero-ink": "var(--on-lead)",
      "--hero-muted": "color-mix(in oklab, var(--on-lead) 84%, var(--lead))", "--hero-label": "var(--on-lead)", "--hero-r": "0",
      "--hero-p": "clamp(48px, 8cqi, 112px) var(--pad)", "--hero-txt-basis": "100%", "--hero-img-basis": "100%", "--hero-img-order": "1",
      "--hero-img-h": "clamp(160px, 24cqi, 300px)", "--hero-img-r": "2px", "--hero-align": "left", "--hero-txt-max": "1000px",
      "--hero-btn-bg": "var(--on-lead)", "--hero-btn-ink": "var(--lead)",
      "--co-bg": "var(--support)", "--co-ink": "var(--on-support)", "--co-bw": "0", "--co-bc": "transparent", "--co-r": "3px",
      "--co-p": "clamp(24px, 4cqi, 44px)", "--co-align": "left", "--co-style": "normal", "--co-size": "clamp(20px, 2.8cqi, 28px)", "--co-w": "800",
      "--tl-cols": "minmax(84px, 170px) 1fr", "--tl-ys": "clamp(30px, 4.4cqi, 46px)", "--tl-yw": "900", "--tl-yc": "var(--lead)",
      "--tl-dot": "none", "--tl-rule": "2px solid var(--ink)",
      "--tag-bg": "var(--lead)", "--tag-bd": "0", "--tag-r": "2px", "--tag-p": "7px 12px", "--tag-case": "uppercase", "--tag-w": "800",
      "--tag-ink": "var(--on-lead)", "--tag-size": "12px", "--tag-track": "0.06em",
      "--av-r": "2px", "--dot-r": "0", "--play-r": "2px",
      "--cta-bg": "var(--lead)", "--cta-ink": "var(--on-lead)", "--cta-muted": "color-mix(in oklab, var(--on-lead) 84%, var(--lead))",
      "--cta-btn-bg": "var(--on-lead)", "--cta-btn-ink": "var(--lead)", "--cta-r": "0", "--cta-p": "clamp(28px, 5cqi, 56px)",
      "--quote-size": "clamp(26px, 4cqi, 42px)", "--quote-bw": "0 0 0 0", "--num-size": "clamp(48px, 8cqi, 88px)",
    },
  },
  warm: {
    name: "Warm", font: "figtree",
    diff: "Very round corners, soft tinted fills and pill buttons. Approachable first, impressive second.",
    when: "The audience is a community rather than a client: small groups, volunteers, family pages.",
    v: {
      "--col": "1000px", "--wide": "1040px", "--h-w": "700", "--h-track": "-0.02em", "--h-case": "none", "--h-lh": "1.08",
      "--h1": "clamp(36px, 5.8cqi, 64px)", "--h2": "clamp(26px, 3.2cqi, 38px)",
      "--label-w": "700", "--label-track": "0.01em", "--label-case": "none", "--label-c": "var(--support)", "--label-size": "14px",
      "--r": "26px", "--img-r": "18px", "--card-bg": "var(--tint)", "--card-bd": "0", "--card-bt": "0",
      "--card-p": "clamp(16px, 2.4cqi, 22px)", "--card-sh": "none",
      "--band-bg": "transparent", "--sec-rule": "0", "--sec-pt": "0",
      "--btn-r": "999px", "--btn-p": "13px 24px", "--btn-w": "700",
      "--hero-outer-p": "clamp(10px, 2cqi, 20px)", "--hero-bg": "var(--tint)", "--hero-ink": "var(--ink)", "--hero-r": "28px",
      "--hero-p": "clamp(32px, 6cqi, 80px) clamp(22px, 5cqi, 64px)", "--hero-txt-basis": "340px", "--hero-img-basis": "300px",
      "--hero-img-order": "1", "--hero-img-h": "clamp(240px, 36cqi, 400px)", "--hero-img-r": "22px", "--hero-align": "left",
      "--hero-txt-max": "540px",
      "--co-bg": "var(--tint-2)", "--co-ink": "var(--ink)", "--co-bw": "0", "--co-bc": "transparent", "--co-r": "26px",
      "--co-p": "clamp(22px, 3cqi, 32px)", "--co-align": "left", "--co-style": "normal", "--co-size": "clamp(18px, 2.2cqi, 22px)", "--co-w": "600",
      "--tl-cols": "minmax(80px, 124px) 1fr", "--tl-ys": "13px", "--tl-yw": "700", "--tl-yc": "var(--lead)", "--tl-dot": "none",
      "--tl-rule": "0", "--tl-ybg": "var(--lead-tint)", "--tl-yp": "6px 12px", "--tl-yr": "999px",
      "--tag-bg": "var(--tint-2)", "--tag-bd": "0", "--tag-r": "999px", "--tag-p": "8px 15px", "--tag-case": "none", "--tag-w": "600",
      "--av-r": "50%",
      "--cta-bg": "var(--lead-tint)", "--cta-ink": "var(--ink)", "--cta-r": "28px", "--cta-p": "clamp(28px, 5cqi, 52px)",
      "--cta-dir": "column", "--cta-items": "center", "--cta-align": "center", "--quote-bw": "0 0 0 0",
    },
  },
  editorial: {
    name: "Editorial", font: "serif",
    diff: "A narrow serif reading column with ruled sections, drop caps and an italic lede.",
    when: "People will actually sit and read: devotionals, essays, long write-ups.",
    v: {
      "--col": "680px", "--wide": "920px", "--h-w": "600", "--h-track": "-0.015em", "--h-case": "none", "--h-lh": "1.08",
      "--h1": "clamp(36px, 5.6cqi, 64px)", "--h2": "clamp(26px, 3.2cqi, 36px)",
      "--label-w": "600", "--label-track": "0.16em", "--label-case": "uppercase", "--label-c": "var(--lead)", "--label-size": "11px",
      "--lede-style": "italic", "--lede-size": "clamp(19px, 2.4cqi, 23px)",
      "--r": "0", "--img-r": "0", "--card-bg": "transparent", "--card-bd": "0", "--card-bt": "1px solid var(--ink)",
      "--card-p": "16px 0 0", "--card-sh": "none",
      "--band-bg": "transparent", "--sec-rule": "3px double var(--ink)", "--sec-pt": "14px",
      "--btn-r": "0", "--btn-p": "12px 20px", "--btn-w": "600", "--btn-case": "uppercase", "--btn-track": "0.12em", "--btn-size": "12px",
      "--hero-outer-p": "0", "--hero-bg": "transparent", "--hero-ink": "var(--ink)", "--hero-r": "0",
      "--hero-p": "0 0 clamp(32px, 6cqi, 64px)", "--hero-max": "none", "--hero-txt-p": "0 var(--pad)", "--hero-txt-basis": "100%",
      "--hero-img-basis": "100%", "--hero-img-order": "-1", "--hero-img-h": "clamp(200px, 30cqi, 380px)", "--hero-img-r": "0",
      "--hero-align": "center", "--hero-txt-max": "680px", "--hero-txt-m": "0 auto", "--hero-justify": "center",
      "--co-bg": "transparent", "--co-ink": "var(--ink)", "--co-bw": "1px 0", "--co-bc": "var(--ink)", "--co-r": "0",
      "--co-p": "28px 0", "--co-align": "center", "--co-style": "italic", "--co-size": "clamp(21px, 2.8cqi, 27px)", "--co-w": "400",
      "--tl-cols": "minmax(64px, 110px) 1fr", "--tl-ys": "12px", "--tl-yw": "600", "--tl-yc": "var(--lead)", "--tl-dot": "none",
      "--tl-rule": "1px solid var(--line)", "--tl-ytrack": "0.12em",
      "--dc-float": "left", "--dc-size": "3.7em", "--dc-lh": "0.8", "--dc-w": "600", "--dc-m": "6px 10px 0 0", "--dc-c": "var(--lead)",
      "--tag-bg": "transparent", "--tag-bd": "0", "--tag-r": "0", "--tag-p": "2px 0", "--tag-case": "uppercase", "--tag-w": "600",
      "--tag-ink": "var(--lead)", "--tag-size": "12px", "--tag-track": "0.12em",
      "--av-r": "50%", "--nav-bd": "1px solid var(--ink)",
      "--cta-bg": "transparent", "--cta-ink": "var(--ink)", "--cta-bw": "1px 0", "--cta-bc": "var(--ink)", "--cta-r": "0",
      "--cta-p": "36px 0", "--cta-dir": "column", "--cta-items": "center", "--cta-align": "center",
      "--quote-style": "italic", "--quote-align": "center", "--quote-bw": "1px 0", "--quote-bc": "var(--ink)",
      "--quote-size": "clamp(24px, 3.4cqi, 32px)",
    },
  },
};

function colors(palette: string, mode: Mode): Vars {
  const c = PALETTES[palette][mode];
  const d = mode === "dark";
  return {
    "--lead": c.lead, "--support": c.support, "--hl": c.hl, "--bg": c.bg,
    "--ink": d ? "color-mix(in oklab, var(--support) 12%, #f3f5f8)" : "color-mix(in oklab, var(--support) 22%, #0c0f14)",
    "--muted": d ? "color-mix(in oklab, var(--support) 72%, #ffffff)" : "color-mix(in oklab, var(--support) 82%, #0c0f14)",
    "--surface": d ? "color-mix(in oklab, var(--bg) 90%, #ffffff)" : "#ffffff",
    "--tint": `color-mix(in oklab, var(--support) ${d ? 14 : 9}%, var(--bg))`,
    "--tint-2": `color-mix(in oklab, var(--support) ${d ? 22 : 16}%, var(--bg))`,
    "--lead-tint": `color-mix(in oklab, var(--lead) ${d ? 16 : 11}%, var(--bg))`,
    "--line": `color-mix(in oklab, var(--support) ${d ? 34 : 26}%, var(--bg))`,
    "--ph-a": `color-mix(in oklab, var(--support) ${d ? 30 : 22}%, transparent)`,
    "--ph-b": `color-mix(in oklab, var(--support) ${d ? 16 : 10}%, var(--bg))`,
    "--on-lead": d ? c.bg : "#ffffff",
    "--on-support": d ? c.bg : "#ffffff",
  };
}

export type Design = { language: string; palette: string; font: string };

export const DEFAULT_DESIGN: Design = { language: "modern", palette: "slate", font: "public" };

// The page's look off its properties, tolerating anything unknown: a missing or
// retired choice falls back to the default, and no font means the language's own.
export function readDesign(properties: unknown): Design {
  const raw = ((properties as Record<string, unknown> | null)?.design ?? {}) as Partial<Design>;
  const language = typeof raw.language === "string" && LANGUAGES[raw.language] ? raw.language : DEFAULT_DESIGN.language;
  const palette = typeof raw.palette === "string" && PALETTES[raw.palette] ? raw.palette : DEFAULT_DESIGN.palette;
  const font = typeof raw.font === "string" && FONTS[raw.font] ? raw.font : LANGUAGES[language].font;
  return { language, palette, font };
}

const decl = (v: Vars) => Object.entries(v).map(([k, val]) => `${k}:${val}`).join(";");

// The :root block for a design: the language's variables and the palette's light
// colors, then its dark colors for readers whose system is dark.
export function themeCss(design: Design): string {
  const lang = LANGUAGES[design.language] ?? LANGUAGES[DEFAULT_DESIGN.language];
  const palette = PALETTES[design.palette] ? design.palette : DEFAULT_DESIGN.palette;
  const font = (FONTS[design.font] ?? FONTS[lang.font]).stack;
  const dark: Vars = { ...colors(palette, "dark") };
  if (design.language === "modern") dark["--card-sh"] = "0 0 0 1px var(--line)";
  return (
    `:root{${decl({ ...BASE, ...lang.v, ...colors(palette, "light") })};--font:${font};color-scheme:light}` +
    `@media (prefers-color-scheme:dark){:root{${decl(dark)};color-scheme:dark}}`
  );
}
