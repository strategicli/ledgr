// Mail & Calendar (plan note a06242d3): Outlook and Gmail, read and answered
// inside Ledgr, live from the providers rather than copied. Pure manifest: no
// DB, no fs.
//
// Hub only. The module runs where the Tailscale module runs (same check, the
// same function): never on Vercel, and only on an install the supervisor
// started. Its routes refuse anywhere else (lib/gate.ts), and its sign-ins
// live in the hub's data folder (lib/store.ts), so even code reached on
// Vercel would have nothing to sign in with.
//
// Phase 1 (foundation): the two sign-ins, the provider action list
// (lib/types.ts) and the safe mail viewer. Phase 2 (reading): the /mail page
// (src/app/mail/page.tsx, gated by pageGate + mailAvailable) over lib/reading.ts.
import type { ModuleManifest } from "@/lib/modules";
import { tailscaleAvailable } from "@/modules/tailscale/manifest";

export const mailAvailable = tailscaleAvailable;

const MAIL_INSTRUCTIONS =
  "MAIL: the owner's Outlook and Gmail are readable through the mail_* tools (only on the Ledgr on their own " +
  "computer). mail_search lists or searches (Gmail-style operators work for both accounts; words search the " +
  "whole mailbox) and shows which Ledgr items each email is already linked to. mail_read gives the text of an " +
  "email or conversation. mail_make_item files an email as a task, note or meeting; mail_import_attachments " +
  "copies its files into Ledgr. mail_act archives, trashes, moves, flags and tags; confirm before acting on " +
  "mail the owner didn't point you at. Nothing here sends mail.";

export const mailModule: ModuleManifest = {
  id: "mail",
  label: "Mail & Calendar",
  description:
    "Read and answer your Outlook and Gmail mail and calendars inside Ledgr. Runs only on a Ledgr installed on your own computer.",
  enabledByDefault: false,
  types: [],
  exporters: [],
  available: mailAvailable,
  settingsPanel: "mail",
  settingsPanelOpen: true,
  mcpTools: {
    names: [
      "mail_accounts",
      "mail_list_folders",
      "mail_list_tags",
      "mail_search",
      "mail_read",
      "mail_act",
      "mail_make_item",
      "mail_import_attachments",
    ],
    instructions: MAIL_INSTRUCTIONS,
  },
  routes: [
    "src/app/api/mail/accounts/route.ts",
    "src/app/api/mail/google/start/route.ts",
    "src/app/api/mail/google/callback/route.ts",
    "src/app/api/mail/read/route.ts",
    "src/app/api/mail/attachment/route.ts",
    "src/app/api/mail/act/route.ts",
    "src/app/api/mail/link/route.ts",
    "src/app/api/machine/mail-flags/route.ts",
  ],
};
