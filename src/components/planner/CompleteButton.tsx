// The circular done-toggle that rides a Planner task chip/block (Slice 1). It
// sits inside a draggable, click-to-open chip, so it must not start a drag or
// trigger navigation: it stops pointer/mouse-down (so the parent's HTML5 drag
// never arms) and stops the click (so the parent's open-item handler is skipped).
//
// Visibility: hidden until the chip is hovered/focused on fine pointers, always
// visible on coarse pointers (touch has no hover, and long-press is the drag
// gesture, so the button is the only tap-to-complete affordance there).
"use client";

export default function CompleteButton({
  done,
  onToggle,
}: {
  done: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      draggable={false}
      aria-label={done ? "Mark not done" : "Mark done"}
      title={done ? "Mark not done" : "Mark done"}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border text-transparent transition-opacity hover:text-current focus:opacity-100 focus:outline-none [@media(hover:none)]:opacity-100 ${
        done
          ? "border-transparent text-neutral-100 opacity-100"
          : "border-current opacity-0 group-hover:opacity-100"
      }`}
      style={done ? { backgroundColor: "var(--accent)" } : undefined}
    >
      <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M2.5 6.2l2.2 2.3L9.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
