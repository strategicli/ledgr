#!/usr/bin/env bash
# SessionStart auto-pull. Safe for a hook: only runs when the Bitwarden vault is
# ALREADY unlocked in this environment (you ran `bw unlock` and exported
# BW_SESSION). Never prompts, never blocks, never errors the session.
command -v bw >/dev/null 2>&1 || exit 0
command -v jq >/dev/null 2>&1 || exit 0
[ -n "${BW_SESSION:-}" ] || exit 0
[ "$(bw status 2>/dev/null | jq -r '.status' 2>/dev/null)" = "unlocked" ] || exit 0

root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$root" || exit 0
[ -f scripts/secrets-pull.sh ] || exit 0

if bash scripts/secrets-pull.sh >/dev/null 2>&1; then
  echo "🔐 secrets synced from Bitwarden"
fi
exit 0
