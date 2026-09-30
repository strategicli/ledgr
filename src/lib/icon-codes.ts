// Icon codes in the body dialect's page vocabulary: `:name:` draws one of
// Ledgr's icons (src/lib/nav-icons.ts), optionally sized `:name:large:` or
// `:name:48:`. Shared by the Website Page render (which draws them) and the
// editor (which shows them as small tokens), so the two always agree on what
// counts as an icon.
import { isNavIcon } from "@/lib/nav-icons";

export const ICON_CODE = /(^|[^\w:]):([a-z][a-z0-9-]{1,30})(?::(small|medium|large|xl|\d{1,3}))?:(?![\w:])/g;

export const ICON_SIZES: Record<string, string> = { small: "0.85em", medium: "1.5em", large: "2.5em", xl: "4em" };

// Friendly names people reach for, mapped onto Ledgr's own icon keys.
export const ICON_ALIASES: Record<string, string> = {
  star: "starred", mail: "email", user: "person", users: "people", group: "people", team: "people",
  music: "song", link: "links", map: "place", location: "place", photo: "image", picture: "image",
  play: "video", food: "utensils", coffee: "utensils", clock: "recent", time: "recent", dollar: "money",
  message: "chat", settings: "gear", edit: "edit-doc", pencil: "edit-doc", warning: "alert", file: "document",
  school: "graduation-cap", work: "briefcase", tree: "plant", idea: "lightbulb", award: "trophy",
  sparkles: "sparkle", bible: "scripture", prayer: "cross",
};

// The icon key a code names, or null when it isn't an icon (so it stays text).
export function iconKey(name: string): string | null {
  const key = ICON_ALIASES[name] ?? name;
  return isNavIcon(key) ? key : null;
}
