# Push local secrets up to Bitwarden as Secure Notes (run on your source-of-truth machine).
# Run from the repo root:  pwsh scripts/secrets-push.ps1   (PowerShell 7+ recommended)
$ErrorActionPreference = "Stop"

$Files  = @(".env.local", ".env.production.local")
$Prefix = "ledgr-secret:"
$ClaudeJson = Join-Path $HOME ".claude.json"

if (-not (Get-Command bw -ErrorAction SilentlyContinue)) { throw "bitwarden-cli not installed (scoop install bitwarden-cli)" }

# Unlock (prompts for your master password; the script never sees it).
if ((bw status | ConvertFrom-Json).status -ne "unlocked") { $env:BW_SESSION = (bw unlock --raw) }
bw sync | Out-Null

function Upsert-Note($name, $content) {
  $existing = (bw list items --search $name | ConvertFrom-Json) | Where-Object { $_.name -eq $name } | Select-Object -First 1
  if ($existing) {
    $item = bw get item $existing.id | ConvertFrom-Json
    $item.notes = $content
    ($item | ConvertTo-Json -Depth 30 -Compress) | bw encode | bw edit item $existing.id | Out-Null
    Write-Host "updated: $name"
  } else {
    $tpl = bw get template item | ConvertFrom-Json
    $tpl.type = 2; $tpl.name = $name; $tpl.notes = $content
    $tpl.secureNote = @{ type = 0 }; $tpl.login = $null; $tpl.card = $null; $tpl.identity = $null
    ($tpl | ConvertTo-Json -Depth 30 -Compress) | bw encode | bw create item | Out-Null
    Write-Host "created: $name"
  }
}

foreach ($f in $Files) {
  if (-not (Test-Path $f)) { Write-Host "skip (missing): $f"; continue }
  Upsert-Note "$Prefix$f" (Get-Content $f -Raw)
}

# Biblia API key lives inside ~/.claude.json, not a file — store just the value.
if (Test-Path $ClaudeJson) {
  $val = (Get-Content $ClaudeJson -Raw | ConvertFrom-Json).mcpServers.logos.env.BIBLIA_API_KEY
  if ($val) { Upsert-Note "${Prefix}biblia" $val }
}

Write-Host "done. Run scripts/secrets-pull.ps1 on your other machines."
