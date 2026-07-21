// Global quick capture (the "+"/`q`): the dialog shell around the shared
// CaptureCard (the type-picker header + per-type capture card). The card itself
// (type picker, AddTaskCard, SimpleCapture) lives in CaptureCard.tsx (Slice 3)
// so the Inbox can render the same capture experience inline. This file is just
// the modal positioning + backdrop.
"use client";

import CaptureCard from "@/components/capture/CaptureCard";

export default function CaptureModal({
  typeOptions,
  onClose,
}: {
  typeOptions?: { key: string; label: string }[];
  onClose: () => void;
}) {
  return (
    <div
      // Mobile: a bottom sheet rising from the thumb-anchored trigger (S6);
      // desktop keeps the top-anchored command-bar position.
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:items-start sm:pb-0 sm:pt-[18vh]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Quick capture"
    >
      <div className="w-full max-w-xl" onClick={(e) => e.stopPropagation()}>
        <CaptureCard typeOptions={typeOptions} onDone={onClose} onCancel={onClose} />
      </div>
    </div>
  );
}
