# Pull secrets down from Bitwarden onto this machine.
# Run from the repo root:  pwsh scripts/secrets-pull.ps1   (PowerShell 7+ recommended)
# Existing files are backed up to <file>.bak.<timestamp> first.
$ErrorActionPreference = "Stop"

$Files  = @(".env.local", ".env.production.local")
$Prefix = "ledgr-secret:"
$ClaudeJson = Join-Path $HOME ".claude.json"

if (-not (Get-Command bw -ErrorAction SilentlyContinue)) { throw "bitwarden-cli not installed (scoop install bitwarden-cli)" }

if ((bw status | ConvertFrom-Json).status -ne "unlocked") { $env:BW_SESSION = (bw unlock --raw) }
bw sync | Out-Null

function Get-Note($name) {
  $existing = (bw list items --search $name | ConvertFrom-Json) | Where-Object { $_.name -eq $name } | Select-Object -First 1
  if (-not $existing) { return $null }
  return (bw get item $existing.id | ConvertFrom-Json).notes
}

foreach ($f in $Files) {
  $content = Get-Note "$Prefix$f"
  if ($null -eq $content) { Write-Host "not found in vault: $Prefix$f"; continue }
  if (Test-Path $f) { Copy-Item $f "$f.bak.$([int](Get-Date -UFormat %s))" }
  # Write UTF-8 (no BOM) with LF line endings, matching a normal .env file.
  [System.IO.File]::WriteAllText((Join-Path (Get-Location).Path $f), ($content -replace "`r`n", "`n"))
  Write-Host "wrote: $f"
}

# Splice the Biblia key back into ~/.claude.json without touching anything else.
$biblia = Get-Note "${Prefix}biblia"
if ($biblia -and (Test-Path $ClaudeJson)) {
  if ($PSVersionTable.PSVersion.Major -lt 7) {
    Write-Host "biblia note found, but rewriting ~/.claude.json needs PowerShell 7+; set BIBLIA_API_KEY manually or run the bash version."
  } else {
    $cfg = Get-Content $ClaudeJson -Raw | ConvertFrom-Json
    if ($cfg.mcpServers.logos.env) {
      $cfg.mcpServers.logos.env.BIBLIA_API_KEY = $biblia
      ($cfg | ConvertTo-Json -Depth 30) | Set-Content $ClaudeJson -Encoding utf8
      Write-Host "spliced BIBLIA_API_KEY into ~/.claude.json"
    } else {
      Write-Host "biblia note found but logos MCP server missing in ~/.claude.json; skipped splice"
    }
  }
}

Write-Host "done."
