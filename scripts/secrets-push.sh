#!/usr/bin/env bash
# Push local secrets up to Bitwarden as Secure Notes (run on your source-of-truth machine).
# Run from the repo root:  bash scripts/secrets-push.sh
# Pull them onto another machine with scripts/secrets-pull.sh (or .ps1 on Windows).
set -euo pipefail

# Whole-file secrets: each becomes one Secure Note. Add a file here and it rides along.
FILES=(".env.local" ".env.production.local")
PREFIX="ledgr-secret:"
CLAUDE_JSON="$HOME/.claude.json"

command -v bw >/dev/null || { echo "bitwarden-cli not installed (brew install bitwarden-cli)"; exit 1; }
command -v jq >/dev/null || { echo "jq not installed"; exit 1; }

# Unlock (prompts for your master password; the script never sees it).
if [ "$(bw status | jq -r '.status')" != "unlocked" ]; then
  export BW_SESSION="$(bw unlock --raw)"
fi
bw sync >/dev/null

upsert_note() {
  local name="$1" content="$2"
  local id
  id="$(bw list items --search "$name" | jq -r --arg n "$name" '.[] | select(.name==$n) | .id' | head -1)"
  if [ -n "$id" ]; then
    bw get item "$id" | jq --arg n "$content" '.notes=$n' | bw encode | bw edit item "$id" >/dev/null
    echo "updated: $name"
  else
    bw get template item \
      | jq --arg name "$name" --arg n "$content" '.type=2 | .name=$name | .secureNote={type:0} | .notes=$n | .login=null | .card=null | .identity=null' \
      | bw encode | bw create item >/dev/null
    echo "created: $name"
  fi
}

for f in "${FILES[@]}"; do
  [ -f "$f" ] || { echo "skip (missing): $f"; continue; }
  upsert_note "${PREFIX}${f}" "$(cat "$f")"
done

# Biblia API key lives inside ~/.claude.json, not a file — store just the value.
if [ -f "$CLAUDE_JSON" ]; then
  biblia="$(jq -r '.mcpServers.logos.env.BIBLIA_API_KEY // empty' "$CLAUDE_JSON")"
  [ -n "$biblia" ] && upsert_note "${PREFIX}biblia" "$biblia"
fi

echo "done. Run scripts/secrets-pull.sh (or .ps1) on your other machines."
