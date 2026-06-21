// Todoist sync types + client interface (slice 25, PRD §5.2). The engine talks
// to Todoist only through this interface — the HTTP client is production, a
// stub verifies the push/pull engine against Neon with no token. Conflict rule
// (PRD): Ledgr is canonical for content; only completion + date changes flow
// back from Todoist.
import type { Urgency } from "@/lib/item-enums";

// A Todoist task normalized to what the engine needs. dueDate is the calendar
// day as YYYY-MM-DD (Todoist's own format), matching Ledgr's UTC-midnight
// due-date encoding (ADR-008). priority is Todoist's 1..4 (4 = most urgent).
export type TodoistTask = {
  id: string;
  content: string;
  description: string | null;
  dueDate: string | null;
  priority: number;
  projectId: string | null;
  isCompleted: boolean;
};

export type TodoistCreate = {
  content: string;
  description?: string;
  dueDate?: string | null;
  priority?: number;
};

export interface TodoistClient {
  // Active (not completed) tasks. A pushed task missing from this list has been
  // completed (or deleted) in Todoist — the completion-sync-back signal.
  listActiveTasks(): Promise<TodoistTask[]>;
  // The Inbox project id, for the offline-capture pull-in (tasks created
  // natively in Todoist's inbox). null if it can't be resolved.
  getInboxProjectId(): Promise<string | null>;
  createTask(input: TodoistCreate): Promise<TodoistTask>;
  updateTask(id: string, input: Partial<TodoistCreate>): Promise<void>;
  completeTask(id: string): Promise<void>;
  deleteTask(id: string): Promise<void>;
}

// Ledgr urgency -> Todoist priority (4 = most urgent; 1 = default/none).
const PRIORITY_BY_URGENCY: Record<number, number> = {
  1: 4, 2: 3, 3: 2, 4: 1, 5: 1, 6: 1,
};
export function todoistPriority(urgency: Urgency | null): number {
  return urgency ? PRIORITY_BY_URGENCY[urgency] ?? 1 : 1;
}

// Ledgr stores due_date as a UTC-midnight instant for a calendar day (ADR-008);
// Todoist wants/returns YYYY-MM-DD. These two convert losslessly.
export function dueToTodoist(due: Date | null): string | null {
  return due ? due.toISOString().slice(0, 10) : null;
}
export function dueFromTodoist(date: string | null): Date | null {
  if (!date) return null;
  const d = new Date(`${date}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Per-item Todoist bookkeeping kept in properties.todoist. syncedDue is the
// due value at the last sync, the third leg of the date reconcile (so we can
// tell "Ledgr changed the date" from "Todoist changed the date").
export type TodoistMeta = {
  id: string;
  syncedDue: string | null;
};
