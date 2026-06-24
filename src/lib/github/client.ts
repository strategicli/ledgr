// GitHub-backed shared collab surface: the Changelog (live commit history) and
// the shared collab notes (a committed file). Why GitHub and not the DB:
// Brandon and Tyler each run a separate single-tenant deploy (separate Vercel +
// Neon), so a DB row is never shared between them. Git is already this project's
// shared coordination medium (COLLAB.md, decisions.md), so the Changelog reads
// the repo's commit history live and the collab notes live in a committed file
// both deploys read and write. One PAT, plain fetch, no Octokit (Principle 5).
//
// Same posture as the Graph/Todoist clients: a typed error distinguishes "never
// configured" (visible, benign) from "GitHub said no" (a real failure to
// surface). When GITHUB_TOKEN is unset the Changelog page shows a "not
// configured" note instead of crashing.

const API = "https://api.github.com";
const API_VERSION = "2022-11-28";

export class GithubError extends Error {
  constructor(
    message: string,
    readonly kind: "not_configured" | "auth" | "request",
    readonly status?: number
  ) {
    super(message);
    this.name = "GithubError";
  }
}

export type GithubConfig = {
  token: string;
  // owner/repo, e.g. "strategicli/ledgr".
  repo: string;
  // Branch whose commit history feeds the Changelog (the deploy branch).
  branch: string;
  // Branch the collab notes file lives on. Defaults to the deploy branch; point
  // it at a non-deployed branch (e.g. "collab-notes") to keep a note edit from
  // triggering a Vercel rebuild. Auto-created on first write if it doesn't exist.
  notesBranch: string;
  // Path of the committed notes file in the repo.
  notesPath: string;
};

// Null when GITHUB_TOKEN is unset; callers surface "not configured" rather than
// crash (the storage/Graph posture). A classic PAT or fine-grained token with
// Contents read+write on the repo covers both the changelog reads and the notes
// commits.
export function getGithubConfig(): GithubConfig | null {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;
  const repo = process.env.GITHUB_REPO || "strategicli/ledgr";
  const branch = process.env.GITHUB_BRANCH || "main";
  const notesBranch = process.env.GITHUB_NOTES_BRANCH || branch;
  const notesPath = process.env.GITHUB_NOTES_PATH || "COLLAB_NOTES.md";
  return { token, repo, branch, notesBranch, notesPath };
}

function requireConfig(): GithubConfig {
  const cfg = getGithubConfig();
  if (!cfg) {
    throw new GithubError("GitHub not configured (GITHUB_TOKEN unset)", "not_configured");
  }
  return cfg;
}

type FetchOpts = RequestInit & { revalidate?: number | false };

// The one chokepoint every GitHub caller uses. `revalidate` maps to Next's
// fetch cache: a small number for the moving commit list, false (immutable) for
// per-commit detail, and no caching for writes.
async function gh(cfg: GithubConfig, path: string, opts: FetchOpts = {}): Promise<Response> {
  const { revalidate, headers, ...init } = opts;
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${cfg.token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": API_VERSION,
      ...headers,
    },
    ...(revalidate === undefined ? {} : { next: { revalidate } }),
  });
}

async function ghJson<T>(cfg: GithubConfig, path: string, opts: FetchOpts = {}): Promise<T> {
  const res = await gh(cfg, path, opts);
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) detail = `: ${body.message}`;
    } catch {
      /* non-JSON error body; the status carries enough */
    }
    const kind = res.status === 401 || res.status === 403 ? "auth" : "request";
    throw new GithubError(`GitHub ${path} ${res.status}${detail}`, kind, res.status);
  }
  return (await res.json()) as T;
}

// ── Changelog (commit history) ──────────────────────────────────────────────

export type ChangelogEntry = {
  sha: string;
  shortSha: string;
  subject: string; // first line of the commit message
  body: string; // the rest, if any
  authorName: string;
  authorLogin: string | null;
  avatarUrl: string | null;
  date: string; // ISO 8601
  url: string; // html_url on GitHub
  filesChanged: number;
  additions: number;
  deletions: number;
};

// Shapes of the GitHub REST responses we read (only the fields we use).
type CommitListItem = {
  sha: string;
  html_url: string;
  commit: { message: string; author: { name: string; date: string } | null };
  author: { login: string; avatar_url: string } | null;
};
type CommitDetail = CommitListItem & {
  stats?: { additions: number; deletions: number };
  files?: unknown[];
};

// Pure: fold a list item (+ optional detail with stats) into a ChangelogEntry.
// Exported so the verify script can exercise it without the network.
export function toChangelogEntry(item: CommitListItem, detail?: CommitDetail): ChangelogEntry {
  const message = item.commit.message ?? "";
  const nl = message.indexOf("\n");
  const subject = nl === -1 ? message : message.slice(0, nl);
  const body = nl === -1 ? "" : message.slice(nl + 1).trim();
  return {
    sha: item.sha,
    shortSha: item.sha.slice(0, 7),
    subject: subject.trim() || "(no message)",
    body,
    authorName: item.commit.author?.name ?? item.author?.login ?? "unknown",
    authorLogin: item.author?.login ?? null,
    avatarUrl: item.author?.avatar_url ?? null,
    date: item.commit.author?.date ?? "",
    url: item.html_url,
    filesChanged: detail?.files?.length ?? 0,
    additions: detail?.stats?.additions ?? 0,
    deletions: detail?.stats?.deletions ?? 0,
  };
}

// The commit message the notes-file writes use. Exported so the changelog can
// filter them out: a notes Save is a commit, but it isn't a "change" anyone
// wants in the changelog (and they'd otherwise flood the top of the list).
export const NOTES_COMMIT_PREFIX = "Collab notes update (via Ledgr";

export function isNotesCommit(message: string): boolean {
  return message.startsWith(NOTES_COMMIT_PREFIX);
}

// Recent commits on the deploy branch, each enriched with its file/line counts
// (the "roughly how many things changed" in Tyler's ask). The list call is one
// request, cached briefly so the page stays fresh without hammering; per-commit
// detail is immutable, so it's cached indefinitely and fetched once per commit.
// App-generated notes commits are filtered out, so we over-fetch to still land
// ~limit real entries.
export async function getChangelog(limit = 25): Promise<ChangelogEntry[]> {
  const cfg = requireConfig();
  const fetchN = Math.min(limit * 3, 100);
  const list = await ghJson<CommitListItem[]>(
    cfg,
    `/repos/${cfg.repo}/commits?sha=${encodeURIComponent(cfg.branch)}&per_page=${fetchN}`,
    { revalidate: 60 }
  );
  const real = list.filter((item) => !isNotesCommit(item.commit.message ?? "")).slice(0, limit);
  return Promise.all(
    real.map(async (item) => {
      try {
        const detail = await ghJson<CommitDetail>(
          cfg,
          `/repos/${cfg.repo}/commits/${item.sha}`,
          { revalidate: false } // a commit's diff never changes
        );
        return toChangelogEntry(item, detail);
      } catch {
        // Stats are a nicety; never let one failed detail call sink the page.
        return toChangelogEntry(item);
      }
    })
  );
}

// ── Collab notes (committed file) ─────────────────────────────────────────────

export type CollabNotes = {
  markdown: string;
  // The blob sha GitHub needs to update the file; null when the file does not
  // exist yet (the first write creates it).
  sha: string | null;
};

type ContentsResponse = { content: string; encoding: string; sha: string };

export function decodeContent(res: ContentsResponse): string {
  if (res.encoding === "base64") {
    return Buffer.from(res.content, "base64").toString("utf8");
  }
  return res.content;
}

// Reads the notes file on a given ref. Null when the file/branch isn't there.
async function readContents(cfg: GithubConfig, ref: string, revalidate: number): Promise<{ markdown: string; sha: string } | null> {
  const res = await gh(
    cfg,
    `/repos/${cfg.repo}/contents/${encodeURIComponent(cfg.notesPath)}?ref=${encodeURIComponent(ref)}`,
    { revalidate }
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new GithubError(`GitHub read notes ${res.status}`, res.status === 401 || res.status === 403 ? "auth" : "request", res.status);
  }
  const data = (await res.json()) as ContentsResponse;
  return { markdown: decodeContent(data), sha: data.sha };
}

export async function readNotes(): Promise<CollabNotes> {
  const cfg = requireConfig();
  const onBranch = await readContents(cfg, cfg.notesBranch, 10);
  if (onBranch) return onBranch;
  // Notes branch/file not there yet. When notes live on a separate branch, show
  // the deploy-branch copy for continuity (the notes branch is created from it
  // on first write); sha is null so the next write resolves the real sha.
  if (cfg.notesBranch !== cfg.branch) {
    const onDeploy = await readContents(cfg, cfg.branch, 10);
    if (onDeploy) return { markdown: onDeploy.markdown, sha: null };
  }
  return { markdown: "", sha: null };
}

// Ensures the notes branch exists, creating it from the deploy branch's head if
// not. A no-op when notes live on the deploy branch (the default).
async function ensureNotesBranch(cfg: GithubConfig): Promise<void> {
  if (cfg.notesBranch === cfg.branch) return;
  const ref = await gh(cfg, `/repos/${cfg.repo}/git/ref/heads/${encodeURIComponent(cfg.notesBranch)}`, {
    revalidate: 0,
  });
  if (ref.ok) return;
  if (ref.status !== 404) {
    throw new GithubError(`GitHub branch check ${ref.status}`, ref.status === 401 || ref.status === 403 ? "auth" : "request", ref.status);
  }
  const base = await ghJson<{ object: { sha: string } }>(
    cfg,
    `/repos/${cfg.repo}/git/ref/heads/${encodeURIComponent(cfg.branch)}`,
    { revalidate: 0 }
  );
  await ghJson(cfg, `/repos/${cfg.repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${cfg.notesBranch}`, sha: base.object.sha }),
  });
}

// Commits the notes file (create or update). `sha` is the prior blob sha for an
// update, or null to create; GitHub returns 409 on a stale sha, which the route
// surfaces so a concurrent edit isn't silently clobbered. Clearing the notes is
// just a write of empty content.
export async function writeNotes(
  markdown: string,
  priorSha: string | null,
  authorEmail: string
): Promise<{ sha: string }> {
  const cfg = requireConfig();
  await ensureNotesBranch(cfg);
  // priorSha drives optimistic concurrency for normal edits. When it's null
  // (first write, or just after the notes branch was created carrying the file
  // from the deploy branch), resolve the file's current sha so the PUT updates
  // the existing file instead of 422-ing on an unknown sha.
  let sha = priorSha;
  if (!sha) sha = (await readContents(cfg, cfg.notesBranch, 0))?.sha ?? null;
  const data = await ghJson<{ content: { sha: string } }>(
    cfg,
    `/repos/${cfg.repo}/contents/${encodeURIComponent(cfg.notesPath)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        message: `${NOTES_COMMIT_PREFIX}, ${authorEmail})`,
        content: Buffer.from(markdown, "utf8").toString("base64"),
        branch: cfg.notesBranch,
        ...(sha ? { sha } : {}),
      }),
    }
  );
  return { sha: data.content.sha };
}

// ── Health canary ─────────────────────────────────────────────────────────────

export type GithubHealth =
  | { configured: false }
  | { configured: true; ok: true; repo: string }
  | { configured: true; ok: false; detail: string };

export async function checkGithub(): Promise<GithubHealth> {
  const cfg = getGithubConfig();
  if (!cfg) return { configured: false };
  try {
    await ghJson<{ full_name: string }>(cfg, `/repos/${cfg.repo}`, { revalidate: 60 });
    return { configured: true, ok: true, repo: cfg.repo };
  } catch (err) {
    return { configured: true, ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
