#!/usr/bin/env bash
# Pull secrets down from Bitwarden onto this machine.
# Run from the repo root:  bash scripts/secrets-pull.sh
# Existing files are backed up to <file>.bak.<timestamp> first.
set -euo pipefail

FILES=(".env.local" ".env.production.local")
PREFIX="ledgr-secret:"
CLAUDE_JSON="$HOME/.claude.json"

command -v bw >/dev/null || { echo "bitwarden-cli not installed (brew install bitwarden-cli)"; exit 1; }
command -v jq >/dev/null || { echo "jq not installed"; exit 1; }

if [ "$(bw status | jq -r '.status')" != "unlocked" ]; then
  export BW_SESSION="$(bw unlock --raw)"
fi
bw sync >/dev/null

get_note() {
  local name="$1" id
  id="$(bw list items --search "$name" | jq -r --arg n "$name" '.[] | select(.name==$n) | .id' | head -1)"
  [ -n "$id" ] || return 1
  bw get item "$id" | jq -r '.notes'
}

for f in "${FILES[@]}"; do
  name="${PREFIX}${f}"
  if content="$(get_note "$name")"; then
    [ -f "$f" ] && cp "$f" "$f.bak.$(date +%s)"
    printf '%s' "$content" > "$f"
    echo "wrote: $f"
  else
    echo "not found in vault: $name"
  fi
done

# Splice the Biblia key back into ~/.claude.json without touching anything else.
if biblia="$(get_note "${PREFIX}biblia")"; then
  if [ -f "$CLAUDE_JSON" ] && [ "$(jq 'has("mcpServers") and (.mcpServers|has("logos"))' "$CLAUDE_JSON")" = "true" ]; then
    tmp="$(mktemp)"
    jq --arg v "$biblia" '.mcpServers.logos.env.BIBLIA_API_KEY=$v' "$CLAUDE_JSON" > "$tmp" && mv "$tmp" "$CLAUDE_JSON"
    echo "spliced BIBLIA_API_KEY into ~/.claude.json"
  else
    echo "biblia note found but logos MCP server missing in ~/.claude.json; skipped splice"
  fi
fi

echo "done."
