// The /setup page's checklist (ADR-275): the health checks in plain words. Pure,
// so scripts/verify-first-run.mts can sweep the cases, and so nothing here can
// ever print a secret: its input holds only yes/no facts, never a value.
import type { SchemaState } from "@/lib/updates";

export type SetupFacts = {
  databaseOk: boolean;
  schema: { state: SchemaState; pending: number };
  // null when the database could not be read.
  hasOwner: boolean | null;
  clerkConfigured: boolean;
  builtinOn: boolean;
  // The local no-login mode (a supervisor install with no sign-in).
  machineOnly: boolean;
  deployed: boolean;
  // Run by the local supervisor (it makes its own secrets and holds the tray).
  supervised: boolean;
  oauthSecret: boolean;
  mcpToken: boolean;
  mcpOwner: boolean;
  graphFailing: boolean;
  githubFailing: boolean;
};

export type SetupItem = {
  id: string;
  // done: nothing to do. todo: something is missing. tip: works, worth knowing.
  status: "done" | "todo" | "tip";
  title: string;
  why?: string;
  fix?: string;
  href?: { label: string; path: string };
};

export function setupChecklist(f: SetupFacts): SetupItem[] {
  const out: SetupItem[] = [];

  if (!f.databaseOk) {
    out.push({
      id: "database",
      status: "todo",
      title: "Ledgr can't reach its database",
      why: "Everything you keep in Ledgr lives there, so nothing else can load until it answers.",
      fix: f.deployed
        ? "In your host's settings, check DATABASE_URL. It must be the Neon pooled connection string (its address contains \"-pooler\"). Then redeploy. See runbook §1."
        : f.supervised
          ? "Start Ledgr on this computer: right-click the tray icon and choose Start, or run npm run local:boot. If it is already running, run npm run local:status to see what is wrong."
          : "Set DATABASE_URL in .env.local to a Postgres connection string, then restart the app. See runbook §1.",
    });
    // Nothing below can be known without the database.
    return out;
  }
  out.push({ id: "database", status: "done", title: "Ledgr can reach its database" });

  if (f.schema.state === "pending" || f.schema.state === "empty") {
    out.push({
      id: "schema",
      status: "todo",
      title:
        f.schema.state === "empty"
          ? "The database is empty"
          : `The database is ${f.schema.pending} ${f.schema.pending === 1 ? "change" : "changes"} behind this version of Ledgr`,
      why: "Pages that use the missing tables or columns fail until the database catches up.",
      fix: f.supervised
        ? "Choose Update now in Build → Updates. An update brings the database up to date before it switches over. If that fails, run npm run db:migrate on this computer."
        : "Run npm run db:migrate against this database (a Vercel deploy does this in its build). See runbook §1.",
      href: { label: "Build → Updates", path: "/build/updates" },
    });
  } else if (f.schema.state === "current") {
    out.push({ id: "schema", status: "done", title: "The database is up to date" });
  }

  if (f.hasOwner === false) {
    out.push({
      id: "owner",
      status: "todo",
      title: "This Ledgr has no owner yet",
      why: "Ledgr keeps one person's data. Until it knows who that is, every page is empty.",
      fix: f.supervised
        ? "On this computer, run npm run local:setup-owner (or right-click the Ledgr tray icon and choose Reset sign-in password). It opens this page with a one-time link and asks for your email and a password."
        : f.clerkConfigured
          ? "Sign in. The first person to sign in with Clerk becomes this Ledgr's owner, so do it before sharing the address."
          : f.deployed
            ? "If this is a cloud copy of a Ledgr you already run, pair it with that one (above): your owner and password arrive with your data. Otherwise run npm run db:seed with SEED_OWNER_EMAIL set to your email address. See runbook §1."
            : "Run npm run db:seed with SEED_OWNER_EMAIL set to your email address. See runbook §1.",
      href: f.clerkConfigured && !f.supervised ? { label: "Sign in", path: "/sign-in" } : undefined,
    });
  } else if (f.hasOwner) {
    out.push({ id: "owner", status: "done", title: "This Ledgr has an owner" });
  }

  if (f.clerkConfigured || f.builtinOn) {
    out.push({
      id: "signin",
      status: "done",
      title: f.builtinOn ? "Sign-in is set up (your Ledgr password)" : "Sign-in is set up (Clerk)",
    });
  } else if (f.machineOnly) {
    out.push({
      id: "signin",
      status: "tip",
      title: "No sign-in: only this computer can open Ledgr",
      why: "With no password, Ledgr answers only the computer it runs on, so nobody on your wifi can open it.",
      fix: "To use it from your phone or another computer, set a password in User Settings → Sign-in.",
      href: { label: "User Settings", path: "/settings#sign-in" },
    });
  } else {
    out.push({
      id: "signin",
      status: "todo",
      title: "There is no way to sign in",
      why: f.deployed
        ? "A Ledgr on the internet with no sign-in would let anyone read your data, so it refuses every page instead."
        : "Nobody can be recognized as the owner, so every page renders empty.",
      fix: f.deployed
        ? "Add Clerk's two keys (NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY) in your host's environment settings and redeploy. See runbook §1."
        : "For local development, set DEV_USER_EMAIL in .env.local to the owner's email and run npm run dev.",
    });
  }

  out.push(
    f.oauthSecret
      ? { id: "oauth", status: "done", title: "Claude can connect (the connector secret is set)" }
      : {
          id: "oauth",
          status: "todo",
          title: "Claude can't connect yet",
          why: "Claude on the web and on your phone connects through a secret this Ledgr signs its MCP tokens with, and Build → AI & MCP can't make a token without it.",
          fix: f.supervised
            ? "Restart Ledgr (tray icon → Restart). It makes this secret itself the first time it starts with this version."
            : "Add LEDGR_OAUTH_SECRET, set to a long random value (for example the output of openssl rand -hex 32), in your host's environment settings and redeploy. See runbook §3a.",
        }
  );

  if (f.hasOwner) {
    if (!f.mcpToken) {
      out.push({
        id: "mcp-token",
        status: "tip",
        title: "No token for Claude Code yet",
        why: "Claude Code and other assistants need a token to reach your data.",
        fix: f.oauthSecret
          ? "Make one in Build → AI & MCP. It shows the command to paste into Claude Code."
          : "Fix the item above first, then make one in Build → AI & MCP.",
        href: { label: "Build → AI & MCP", path: "/build/claude" },
      });
    } else if (!f.mcpOwner) {
      out.push({
        id: "mcp-owner",
        status: "todo",
        title: "Claude can't tell whose data to use",
        why: "This Ledgr has more than one account, and none matches the addresses the MCP server looks for.",
        fix: "Set LEDGR_MCP_OWNER_UPN to the owner's email address. See runbook §1f.",
      });
    } else {
      out.push({ id: "mcp-token", status: "done", title: "Claude Code can connect with a token" });
    }
  }

  if (f.graphFailing) {
    out.push({
      id: "graph",
      status: "todo",
      title: "The Microsoft 365 connection is failing",
      why: "Calendar sync, email capture and the OneDrive export stop until it works again.",
      fix: "The usual cause is an expired client secret. Make a new one in the Azure app registration and update GRAPH_CLIENT_SECRET. See the runbook's token rotation section.",
    });
  }
  if (f.githubFailing) {
    out.push({
      id: "github",
      status: "todo",
      title: "The GitHub connection is failing",
      why: "The Changelog and the Updates page read from GitHub.",
      fix: "Check that GITHUB_TOKEN is still valid and can read the repository. See the runbook's token rotation section.",
    });
  }
  return out;
}

/**
 * Who may see the checklist. Its details describe how this copy is configured,
 * so once an owner exists only that owner sees them; before that there is
 * nobody to protect and the person setting up needs every line. When the
 * database can't be read the only detail shown is that one fact, which /health
 * already reports publicly.
 */
export function setupView(v: { hasOwner: boolean | null; viewerIsOwner: boolean }): "checklist" | "set-up" | "database-only" {
  if (v.viewerIsOwner) return "checklist";
  if (v.hasOwner === null) return "database-only";
  return v.hasOwner ? "set-up" : "checklist";
}
