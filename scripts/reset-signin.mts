// LAST-RESORT sign-in reset (ADR-274), run on a machine that can reach the
// database. For when every other way back in is gone: no signed-in device, no
// recovery code, and the tray's "Reset sign-in password" isn't available (for
// example a cloud copy with no hub). Anyone who can run this already has the
// whole database, so it weakens nothing.
//
// What it does: gives the owner a new TEMPORARY password (printed once), clears
// this copy's failed-attempt counter, and with --method=default also switches
// the copy back to its default sign-in (Clerk where configured, else no
// sign-in on a local install). Recovery codes and sessions are left alone.
//
//   npm run signin:reset -- --config supervisor/config.json        # a local hub or spoke
//   DATABASE_URL="postgresql://..." npm run signin:reset             # any copy, e.g. the cloud
//   ... -- --email you@example.com      # only if the database holds more than one person
//   ... -- --method=default             # also turn password sign-in off on that copy
//   ... -- --method=builtin             # also turn it ON (a new cloud copy with no Clerk)
//
// The password syncs, so resetting the hub fixes a cloud copy at its next sync.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import pg from "pg";
import { generateRecoveryCodes, hashPassword, newCookieSecret } from "../src/lib/auth/builtin-core";

const args = process.argv.slice(2);
const value = (name: string): string | null => {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
};

async function connectionString(): Promise<string> {
  const configPath = value("config");
  if (configPath) {
    const { normalizeConfig, buildDbUrl } = await import("../supervisor/lib.mjs");
    const abs = resolve(configPath);
    return buildDbUrl(normalizeConfig(JSON.parse(readFileSync(abs, "utf8")), dirname(abs)));
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Say which database: --config <supervisor/config.json> for a local copy, or set DATABASE_URL.");
    process.exit(2);
  }
  return url;
}

const url = await connectionString();
const host = (() => {
  try {
    return new URL(url).hostname;
  } catch {
    return "(unparseable address)";
  }
})();
const db = new pg.Client({ connectionString: url });
await db.connect();
try {
  const email = value("email");
  const all = (
    await db.query<{ id: string; email: string; has_pw: boolean }>(
      email
        ? "select id, email, password_hash is not null as has_pw from users where lower(email) = lower($1)"
        : "select id, email, password_hash is not null as has_pw from users",
      email ? [email] : []
    )
  ).rows;
  // Without --email: the one person holding a password, else the only person.
  const withPw = all.filter((r) => r.has_pw);
  const rows = !email && withPw.length === 1 ? withPw : all;
  if (rows.length !== 1) {
    console.error(
      rows.length === 0
        ? `No owner found on ${host}${email ? ` for ${email}` : ""}.`
        : `${rows.length} people on ${host}; say which with --email <address>.`
    );
    process.exit(1);
  }
  const owner = rows[0];
  const temporary = generateRecoveryCodes(1)[0].toLowerCase();
  await db.query("update users set password_hash = $1 where id = $2", [await hashPassword(temporary), owner.id]);
  // This copy's own sign-in row (a brand-new database has none yet), then lift
  // any wait left by earlier wrong guesses.
  await db.query(
    "insert into signin_install (id, cookie_secret) values (1, $1) on conflict (id) do nothing",
    [newCookieSecret()]
  );
  await db.query("update signin_install set failed_count = 0, failed_at = null where id = 1");
  const method = value("method");
  if (method === "default") {
    await db.query("update signin_install set method = null where id = 1");
    console.log("This copy is back on its default sign-in (Clerk, or no sign-in on a local install).");
  } else if (method === "builtin") {
    await db.query("update signin_install set method = 'builtin' where id = 1");
    console.log("This copy now signs in with the password.");
  }
  console.log(
    `\nNew temporary password for ${owner.email} on ${host}:\n\n    ${temporary}\n\n` +
      "Sign in with it, then set your own in User Settings → Sign-in.\n" +
      "It works on every copy once they sync. Nobody else has been signed out."
  );
} finally {
  await db.end();
}
