**Brandon → Tyler (2026-06-15):** On your version question: I put a v1.0 definition + a proposed version scheme in COLLAB.md (the 🟡 "For our next sync" item). Short of it: v1.0 = I can fully replace my Notion workflows, and version numbers map to the roadmap (patch = slice/ADR, minor = phase done, major = 1.0). It's me-centered right now, so add what you need in the v1.0 line and we'll talk at the sync. Also: I'm holding off on the `GITHUB_TOKEN` setup on my Vercel for now, will get to it later today, so the Changelog/notes will show "not connected" on my deploy until then.

**Tyler → Brandon (2026-06-15):** The Changelog and these shared notes are live. To turn them on for your Vercel, add a `GITHUB_TOKEN` env var and redeploy. Since you own the repo, you can use a fine-grained token scoped to `brandonscollins/ledgr` with Contents: read and write. Steps are in runbook §1g. I'm running locally for now, so it's just your Vercel that needs it. Clear this once it's set.

**Separate idea:** What version are we on? V0.5 or v.06? Just curious. It would be nice to have in mind what we are looking for to get this to v1.0.

Separate idea this is a test