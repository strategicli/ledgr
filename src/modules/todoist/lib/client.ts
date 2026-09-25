// Todoist REST API v2 client (slice 25). Plain fetch, no SDK (rule 5). Token
// from TODOIST_TOKEN; null when unset so callers report "not configured"
// instead of crashing (same posture as Graph/storage).
import type { TodoistClient, TodoistCreate, TodoistTask } from "./types";

const BASE = "https://api.todoist.com/rest/v2";

type RawTask = {
  id: string;
  content: string;
  description?: string;
  due?: { date?: string } | null;
  priority?: number;
  project_id?: string;
  is_completed?: boolean;
};

function normalize(t: RawTask): TodoistTask {
  return {
    id: t.id,
    content: t.content,
    description: t.description || null,
    dueDate: t.due?.date ? t.due.date.slice(0, 10) : null,
    priority: t.priority ?? 1,
    projectId: t.project_id ?? null,
    isCompleted: t.is_completed === true,
  };
}

class HttpTodoistClient implements TodoistClient {
  constructor(private token: string) {}

  private async req(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.req(path, init);
    if (!res.ok) {
      throw new Error(`Todoist ${init?.method ?? "GET"} ${path} failed: ${res.status}`);
    }
    return (await res.json()) as T;
  }

  async listActiveTasks(): Promise<TodoistTask[]> {
    const raw = await this.json<RawTask[]>("/tasks");
    return raw.map(normalize);
  }

  async getInboxProjectId(): Promise<string | null> {
    const projects = await this.json<{ id: string; is_inbox_project?: boolean }[]>("/projects");
    return projects.find((p) => p.is_inbox_project)?.id ?? null;
  }

  // Body shape per the REST v2 docs: due_date is YYYY-MM-DD; "no_due_date" or
  // omitting clears it on update.
  private body(input: Partial<TodoistCreate>): Record<string, unknown> {
    const b: Record<string, unknown> = {};
    if (input.content !== undefined) b.content = input.content;
    if (input.description !== undefined) b.description = input.description;
    if (input.priority !== undefined) b.priority = input.priority;
    if (input.dueDate !== undefined) {
      if (input.dueDate === null) b.due_string = "no date";
      else b.due_date = input.dueDate;
    }
    return b;
  }

  async createTask(input: TodoistCreate): Promise<TodoistTask> {
    const raw = await this.json<RawTask>("/tasks", {
      method: "POST",
      body: JSON.stringify(this.body(input)),
    });
    return normalize(raw);
  }

  async updateTask(id: string, input: Partial<TodoistCreate>): Promise<void> {
    const res = await this.req(`/tasks/${id}`, {
      method: "POST",
      body: JSON.stringify(this.body(input)),
    });
    if (!res.ok) throw new Error(`Todoist update ${id} failed: ${res.status}`);
  }

  async completeTask(id: string): Promise<void> {
    const res = await this.req(`/tasks/${id}/close`, { method: "POST" });
    if (!res.ok) throw new Error(`Todoist close ${id} failed: ${res.status}`);
  }

  async deleteTask(id: string): Promise<void> {
    const res = await this.req(`/tasks/${id}`, { method: "DELETE" });
    // 404 = already gone, which is fine for our purposes.
    if (!res.ok && res.status !== 404) {
      throw new Error(`Todoist delete ${id} failed: ${res.status}`);
    }
  }
}

export function getTodoistClient(): TodoistClient | null {
  const token = process.env.TODOIST_TOKEN;
  return token ? new HttpTodoistClient(token) : null;
}
