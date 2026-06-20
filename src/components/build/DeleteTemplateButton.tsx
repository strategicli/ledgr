// Delete a template from the Build → Templates index (ADR-093). DELETE drops the
// registry row and soft-deletes its prototype subtree to Trash (templates.ts
// deleteTemplate). In-context confirm via the project-standard ConfirmButton.
"use client";

import { useRouter } from "next/navigation";
import ConfirmButton from "@/components/ui/ConfirmButton";

export default function DeleteTemplateButton({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const router = useRouter();

  async function confirmDelete() {
    const res = await fetch(`/api/templates/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `delete failed (${res.status})`);
    }
    router.refresh();
  }

  return (
    <ConfirmButton
      onConfirm={confirmDelete}
      title={`Delete the “${name}” template?`}
      description="The template's prototype moves to Trash. Items already created from it aren't affected."
      align="right"
      trigger="Delete"
      triggerClassName="rounded px-2 py-0.5 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-red-300"
    />
  );
}
