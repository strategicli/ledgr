# Ledgr

A single-user personal life management system (a Notion replacement): meetings, tasks, notes, and links stored as richly formatted items in Postgres, presented through a Next.js PWA, integrated with Microsoft 365, Todoist, and Claude.

**Start with [`CLAUDE.md`](./CLAUDE.md)**, the operating manual. It points to the PRD (`ledgr-prd.md`), the data model (`schema.md`), the phase plan (`roadmap.md`), the work queue (`next_steps.md`), operations (`runbook.md`), and the decision log (`decisions.md`).

## Stack

Next.js (App Router, TypeScript) on Vercel, Postgres on Neon (via the connection pooler, always), Drizzle ORM, Clerk auth (behind a thin provider interface), BlockNote editor, Cloudflare R2 storage.

## Local development

1. Copy `.env.example` to `.env.local` and fill in values (see `runbook.md` §1).
2. `npm install`
3. `npm run dev`

`/health` reports DB reachability and the last export timestamp.
