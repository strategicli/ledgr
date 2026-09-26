# Ledgr

Ledgr is a personal system for keeping your work and life in one place: tasks, notes, meetings, links, people, and projects, all stored as items that link to each other. Notes are plain Markdown, so everything stays readable and exportable. It runs as a web app you can install on your phone or computer, and Claude can read and update it through a built-in MCP server.

It is built by two people for their own use, one owner per copy. There are no shared accounts: each person runs their own copy and owns their own data.

## What it does

- **Tasks** with due dates, subtasks, repeating tasks, and a daily focus list.
- **Notes and documents** in a rich editor that saves as Markdown, with revision history.
- **Meetings and people**, linked to the tasks and notes that came out of them.
- **Projects** that gather their tasks, notes, meetings, and a timeline in one place.
- **Custom types** for anything else, plus optional modules (songs, calendar sync, email capture, and more) you switch on under Build → Modules.
- **Claude integration** through MCP, so an AI assistant can search, file, and update items for you.
- **Backups:** automatic restore points on a local install, plus an optional plain-file export.

The full list lives in the in-app user guide (Build → Guide).

## Install it on your own computer

This is the recommended way to run Ledgr. Your data stays on your machine, and nothing else needs to be set up. Leave the computer on if you want to reach Ledgr from your phone.

### Windows

1. **[Download Ledgr-Setup.exe](https://github.com/strategicli/ledgr/releases/latest/download/Ledgr-Setup.exe)** and double-click it.
2. The installer is not signed yet, so Windows may say **"Windows protected your PC"**. Choose **More info**, then **Run anyway**.
3. Click through the installer. It installs for your account only and needs no administrator rights.
4. Ledgr opens in your browser on its setup page. Enter your email and a password, save the recovery kit, and type one code back.

Ledgr then starts when you sign in to Windows. It has a Ledgr folder in the Start menu (open, start, stop, reset password, uninstall) and an icon near the clock.

### Mac or Linux

Open **Terminal** (on a Mac: Command-Space, type Terminal, press Return), paste this line, and press Return:

```sh
curl -fsSL https://github.com/strategicli/ledgr/releases/latest/download/install.sh | sh
```

It installs for your account only (no password), then opens your browser on the setup page. Ledgr then starts when you sign in, and a Ledgr launcher appears in Applications › Ledgr (Mac) or your apps menu (Linux). Linux needs Ubuntu 22.04, Debian 12, Fedora 36, or newer.

### After installing

- **Moving from another copy?** The setup page offers to restore a backup. Starting fresh, skip it.
- **Reach it from your phone:** turn on **Private access (Tailscale)** under Build → Modules and click **Connect with Tailscale**. You sign in with a Google, Microsoft, Apple, or GitHub account. Install the Tailscale app on your phone, sign in with the same account, and open the address Ledgr shows you.
- **Share items publicly:** from the same Tailscale panel, **Make this reachable from the internet**. Ledgr only allows this once a password is set.
- **Keep a copy in the cloud** (optional): Build → Network → "Keep a copy in the cloud" pairs your computer with a hosted copy that stays in sync, so Ledgr still works when your computer is off.

### Updating and uninstalling

- **Update:** Build → Updates → **Update**. On Mac or Linux, running the install line again also updates.
- **Uninstall:** Windows uses the Start menu or Windows Settings → Apps. On Mac or Linux, run the install line with `-s -- --uninstall` added after `sh`.
- **Your data is kept** unless you explicitly choose to delete it during uninstall.

## Run it in the cloud instead

Ledgr can also run on Vercel with a Neon Postgres database. This takes accounts on GitHub, Vercel, Neon, and (for now) Clerk, plus some configuration, so it is aimed at people comfortable with those tools. See [`docs/satellite-setup.md`](./docs/satellite-setup.md) and `runbook.md` §1k. A simpler hosted setup is planned.

## Status and license

Ledgr is in daily use by its builders and is still changing quickly. New builds are published from `main` several times a day. The code is public, but **it has no license yet**, which means it is not yet licensed for others to use or redistribute. A license will be added before Ledgr is offered more widely.

## For developers

- **[`CLAUDE.md`](./CLAUDE.md)** is the operating manual and the entry point. It links the product spec (`ledgr-prd.md`), data model (`schema.md`), work queue (`next_steps.md`), operations (`runbook.md`), and decision log (`decisions.md`).
- **The user guide** is one Markdown constant in [`src/lib/mcp/user-guide.ts`](./src/lib/mcp/user-guide.ts). It is shown in the app at `/build/guide` and served to AI clients as `ledgr://guide/using-ledgr`.
- **Stack:** Next.js (App Router, TypeScript), Postgres (Neon in the cloud, embedded Postgres on a local install), Drizzle ORM, a Tiptap editor over Markdown, sign-in by Clerk or Ledgr's own password login, and file storage on Cloudflare R2 or local disk.
- **How installs are built and updated:** runbook §1s (packages), §1t (Windows installer), §1u (Mac and Linux), §1q (Tailscale), §1r (cloud copy).

### Local development

1. Copy `.env.example` to `.env.local` and fill in values (see `runbook.md` §1).
2. `npm install`
3. `npm run dev`

`/health` reports database reachability and the state of scheduled jobs.
