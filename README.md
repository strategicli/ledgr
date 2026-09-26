# Ledgr

A personal life management system (a Notion replacement) built by Brandon and Tyler on one shared codebase with separate single-tenant deployments: meetings, tasks, notes, links, and richer workflow items (songs, papers, sermons) stored as **Markdown** documents in Postgres, presented through a Next.js PWA, integrated with Microsoft 365 / Google, Todoist, and Claude.

**Start with [`CLAUDE.md`](./CLAUDE.md)**, the operating manual. It points to the PRD (`ledgr-prd.md`), the data model (`schema.md`), the phase plan (`roadmap.md`), the work queue (`next_steps.md`), operations (`runbook.md`), and the decision log (`decisions.md`).

**To find out what Ledgr actually does**, read the user guide rather than the docs above: it is one markdown constant in [`src/lib/mcp/user-guide.ts`](./src/lib/mcp/user-guide.ts), rendered in-app at `/build/guide` (Build → MAINTAIN) and served to any connected AI as `ledgr://guide/using-ledgr`. It is a feature index with a route on every entry. A slice that changes what the owner can do updates it in the same PR (ADR-189).

## Download Ledgr for Windows

**[Download Ledgr for Windows](https://github.com/strategicli/ledgr/releases/latest/download/Ledgr-Setup.exe)** (the newest `main` build), then double-click `Ledgr-Setup.exe`. It installs for your Windows account only, with no Administrator prompt, and ends in your browser on Ledgr's setup page. Your data lives in `%LOCALAPPDATA%\LedgrData`, apart from the program, so updating or uninstalling never touches it unless you tick the box that says so.

The installer is not signed yet, so Windows may show **"Windows protected your PC"**. That is Windows SmartScreen saying it does not recognize the file, not that anything is wrong with it: choose **More info**, then **Run anyway**. Each release lists the file's sha256 if you want to check your download. How the installer works: `runbook.md` §1t.

## Download Ledgr for Mac or Linux

Open **Terminal** (on a Mac: press Command-Space, type Terminal, press Return), paste this one line, and press Return:

```sh
curl -fsSL https://github.com/strategicli/ledgr/releases/latest/download/install.sh | sh
```

It downloads the newest `main` build for your computer (Apple silicon or Intel Mac, or 64-bit Linux), checks its sha256, installs it for your account only (no password), starts Ledgr, and opens your browser on the setup page. Ledgr then starts by itself when you sign in, and **Ledgr** appears in your Applications › Ledgr folder (Mac) or your applications menu (Linux). Your data lives apart from the program, in `~/Library/Application Support/Ledgr/data` on a Mac or `~/.local/share/ledgr/data` on Linux.

- **To update**, run the same line again. Ledgr also updates itself from Build → Updates.
- **To uninstall**, run it with `--uninstall`: `curl -fsSL https://github.com/strategicli/ledgr/releases/latest/download/install.sh | sh -s -- --uninstall`. Your data is kept unless you type `DELETE` and then confirm.
- **Why a Terminal line and not a download:** a file downloaded in a browser gets macOS's "downloaded from the internet" flag, and then Gatekeeper questions every program inside it. A download the script makes does not, so nothing asks. Linux needs glibc 2.34 or newer (Ubuntu 22.04, Debian 12, Fedora 36 or later). How it works: `runbook.md` §1u.

## Stack

Next.js (App Router, TypeScript) on Vercel, Postgres on Neon (via the connection pooler, always), Drizzle ORM, Clerk auth (behind a thin provider interface), a markdown-native WYSIWYG editor (library TBD; markdown is the canonical body format since ADR-037), Cloudflare R2 storage.

## Local development

1. Copy `.env.example` to `.env.local` and fill in values (see `runbook.md` §1).
2. `npm install`
3. `npm run dev`

`/health` reports DB reachability and the last export timestamp.
