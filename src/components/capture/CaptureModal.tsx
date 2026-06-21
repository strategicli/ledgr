// Global quick capture (the "+"): a task lands in the Inbox by default (Tyler,
// 2026-06-21). A thin modal shell around the shared AddTaskCard, so the global
// capture is the same card used inline per-day, in project cards, and on items
// — one consistent add-task experience. (typeOptions kept for the nav caller's
// signature but unused; capture is task-first + Inbox-defaulted now.)
"use client";

import { useEffect } from "react";
import AddTaskCard from "@/components/tasks/AddTaskCard";

export default function CaptureModal({
  onClose,
}: {
  typeOptions?: { key: string; label: string }[];
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[18vh]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Quick capture"
    >
      <div className="w-full max-w-xl" onClick={(e) => e.stopPropagation()}>
        <AddTaskCard onDone={onClose} onCancel={onClose} />
      </div>
    </div>
  );
}
