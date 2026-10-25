// Line icons for the mail screen, drawn the way the rest of Ledgr draws them
// (24px box, 1.8 stroke, round caps; see components/nav). Inline SVG, no icon
// package (Principle 5).
const PATHS = {
  inbox: "M22 12h-6l-2 3h-4l-2-3H2|M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
  draft: "M12 20h9|M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z",
  send: "m22 2-7 20-4-9-9-4Z|M22 2 11 13",
  archive: "M3 3h18v5H3z|M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8|M10 12h4",
  spam: "M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86z|M12 8v4|M12 16h.01",
  trash: "M3 6h18|M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6|M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
  flag: "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z|M4 22v-7",
  clip: "m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48",
  folder: "M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z",
  move: "M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z|m12 10 3 3-3 3|M9 13h6",
  tag: "M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42z|M7.5 7.5h.01",
  mail: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z|m22 7-10 6L2 7",
  mailOpen: "M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0l8 6Z|m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10",
  task: "M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4z|m8 12 3 3 5-6",
  note: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z|M14 2v5h6|M8 13h8|M8 17h5",
  event: "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z|M16 2v4|M8 2v4|M3 10h18",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z|m21 21-4.3-4.3",
  menu: "M4 6h16|M4 12h16|M4 18h16",
  back: "m15 18-6-6 6-6",
  down: "m6 9 6 6 6-6",
  right: "m9 18 6-6-6-6",
  ext: "M15 3h6v6|M10 14 21 3|M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
  download: "M12 3v12|m8 11 4 4 4-4|M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
  import: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z|M14 2v5h6|M12 11v7|M8.5 14.5h7",
  image: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z|M9 8h.01|m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21",
  check: "M20 6 9 17l-5-5",
  x: "M18 6 6 18|m6 6 12 12",
  link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71|M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className = "", filled }: { name: IconName; size?: number; className?: string; filled?: boolean }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      {PATHS[name].split("|").map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
