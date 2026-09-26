# Ledgr

A personal life management system (a Notion replacement) built by Brandon and Tyler on one shared codebase with separate single-tenant deployments: meetings, tasks, notes, links, and richer workflow items (songs, papers, sermons) stored as **Markdown** documents in Postgres, presented through a Next.js PWA, integrated with Microsoft 365 / Google, Todoist, and Claude.

**Start with [`CLAUDE.md`](./CLAUDE.md)**, the operating manual. It points to the PRD (`ledgr-prd.md`), the data model (`schema.md`), the phase plan (`roadmap.md`), the work queue (`next_steps.md`), operations (`runbook.md`), and the decision log (`decisions.md`).

**To find out what Ledgr actually does**, read the user guide rather than the docs above: it is one markdown constant in [`src/lib/mcp/user-guide.ts`](./src/lib/mcp/user-guide.ts), rendered in-app at `/build/guide` (Build → MAINTAIN) and served to any connected AI as `ledgr://guide/using-ledgr`. It is a feature index with a route on every entry. A slice that changes what the owner can do updates it in the same PR (ADR-189).

## Download Ledgr for Windows

**[Download Ledgr for Windows](https://github.com/strategicli/ledgr/releases/latest/download/Ledgr-Setup.exe)** (the newest `main` build), then double-click `Ledgr-Setup.exe`. It installs for your Windows account only, with no Administrator prompt, and ends in your browser on Ledgr's setup page. Your data lives in `%LOCALAPPDATA%\LedgrData`, apart from the program, so updating or uninstalling never touches it unless you tick the box that says so.

The installer is not signed yet, so Windows may show **"Windows protected your PC"**. That is Windows SmartScreen saying it does not recognize the file, not that anything is wrong with it: choose **More info**, then **Run anyway**. Each release lists the file's sha256 if you want to check your download. How the installer works: `runbook.md` §1t.

## Stack

Next.js (App Router, TypeScript) on Vercel, Postgres on Neon (via the connection pooler, always), Drizzle ORM, Clerk auth (behind a thin provider interface), a markdown-native WYSIWYG editor (library TBD; markdown is the canonical body format since ADR-037), Cloudflare R2 storage.

## Local development

1. Copy `.env.example` to `.env.local` and fill in values (see `runbook.md` §1).
2. `npm install`
3. `npm run dev`

`/health` reports DB reachability and the last export timestamp.
