# The notification-area icon for a local Ledgr peer.
#
# Why it exists: the local service is a background process with no window, so
# until now the only way to know whether Ledgr was running was to open Ledgr —
# which tells you nothing when the answer is "it isn't". This is the surface
# that still works when the app is down: a dot near the clock, coloured by what
# is actually answering, and a right-click menu that can start, restart and stop
# the peer without a terminal.
#
# Written in PowerShell against WinForms on purpose. Windows ships both, so a
# permanently-running tray icon costs this project no new dependency (principle
# 5) and nothing to maintain when Node moves.
#
# It does not supervise anything. It watches two ports and shells out to
# ledgr-ctl for every action, so nothing here can disagree with the CLI.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden \
#     -File ledgr-tray.ps1 -NodePath ... -CtlScript ... -ConfigPath ...
#
# Started and installed by `npm run local:tray`; see ledgr-ctl.mjs doTray.
param(
  [Parameter(Mandatory = $true)][string]$NodePath,
  [Parameter(Mandatory = $true)][string]$CtlScript,
  [Parameter(Mandatory = $true)][string]$ConfigPath,
  [int]$AppPort = 3000,
  [int]$DbPort = 5433,
  [string]$DataDir = "",
  [int]$PollSeconds = 15
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ── State detection ──────────────────────────────────────────────────────────
#
# Two TCP probes, no child processes, because this runs every few seconds
# forever. The app port answering is the only thing that means "Ledgr works";
# the database port answering on its own means the peer is mid-start or the app
# has fallen over, which is worth a different colour from plain "down".

function Test-Port([int]$Port, [int]$TimeoutMs = 700) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) { return $false }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Get-PeerState {
  if (Test-Port $AppPort) { return "serving" }
  if (Test-Port $DbPort) { return "starting" }
  return "down"
}

function Get-BuildSha {
  if (-not $DataDir) { return "" }
  $p = Join-Path $DataDir "live.json"
  if (-not (Test-Path $p)) { return "" }
  try {
    $sha = (Get-Content $p -Raw | ConvertFrom-Json).sha
    if ($sha) { return $sha.Substring(0, 7) }
  } catch { }
  return ""
}

# ── Icons ────────────────────────────────────────────────────────────────────
#
# Drawn once and reused. GetHicon allocates an unmanaged handle every call, so
# building these inside the timer would leak one icon handle every poll.

function New-DotIcon([System.Drawing.Color]$Color) {
  $bmp = New-Object System.Drawing.Bitmap 16, 16
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $brush = New-Object System.Drawing.SolidBrush $Color
  $g.FillEllipse($brush, 2, 2, 12, 12)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(90, 0, 0, 0)), 1
  $g.DrawEllipse($pen, 2, 2, 12, 12)
  $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
  $brush.Dispose(); $pen.Dispose(); $g.Dispose(); $bmp.Dispose()
  return $icon
}

$icons = @{
  serving  = New-DotIcon ([System.Drawing.Color]::FromArgb(34, 170, 85))
  starting = New-DotIcon ([System.Drawing.Color]::FromArgb(220, 160, 40))
  down     = New-DotIcon ([System.Drawing.Color]::FromArgb(210, 60, 60))
}
$labels = @{
  serving  = "Ledgr is running"
  starting = "Ledgr is starting (the app is not answering yet)"
  down     = "Ledgr is NOT running"
}

# ── Actions ──────────────────────────────────────────────────────────────────
#
# Every action is the CLI verb, run hidden and NOT waited on: a restart takes
# the better part of a minute and a frozen tray icon during it would read as a
# crash. The poll below is what reports the result, which also means the icon
# can never claim an outcome the ports do not agree with.

function Invoke-Ctl([string]$Verb) {
  Start-Process -FilePath $NodePath `
    -ArgumentList @($CtlScript, $Verb, "--config=$ConfigPath") `
    -WindowStyle Hidden | Out-Null
}

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = $icons["down"]
$notify.Text = "Ledgr"
$notify.Visible = $true

function Show-Balloon([string]$Title, [string]$Body) {
  $notify.BalloonTipTitle = $Title
  $notify.BalloonTipText = $Body
  $notify.ShowBalloonTip(5000)
}

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$miOpen = $menu.Items.Add("Open Ledgr")
$miOpen.add_Click({ Start-Process "http://localhost:$AppPort" })

$miStatus = $menu.Items.Add("Check status")
$miStatus.add_Click({
    $app = Test-Port $AppPort
    $db = Test-Port $DbPort
    $sha = Get-BuildSha
    $lines = @()
    if ($app) { $lines += "App: answering on port $AppPort" } else { $lines += "App: nothing on port $AppPort" }
    if ($db) { $lines += "Database: answering on port $DbPort" } else { $lines += "Database: nothing on port $DbPort" }
    if ($sha) { $lines += "Build: $sha" }
    Show-Balloon "Ledgr" ($lines -join "`n")
  })

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$miStart = $menu.Items.Add("Start")
$miStart.add_Click({
    Show-Balloon "Ledgr" "Starting the local service. This takes up to a minute."
    Invoke-Ctl "boot"
  })

$miRestart = $menu.Items.Add("Restart")
$miRestart.add_Click({
    Show-Balloon "Ledgr" "Restarting the local service. This takes up to a minute."
    Invoke-Ctl "restart"
  })

$miStop = $menu.Items.Add("Stop")
$miStop.add_Click({
    $answer = [System.Windows.Forms.MessageBox]::Show(
      "Stop the local Ledgr service? Ledgr will be unreachable on this machine until it is started again.",
      "Ledgr", [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Warning)
    if ($answer -eq [System.Windows.Forms.DialogResult]::Yes) {
      Show-Balloon "Ledgr" "Stopping the local service."
      Invoke-Ctl "stop"
    }
  })

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

# Deliberately worded as hiding the ICON, not quitting Ledgr, because those are
# different things and the menu is the only place that distinction is visible.
$miExit = $menu.Items.Add("Hide this icon (Ledgr keeps running)")
$miExit.add_Click({
    $notify.Visible = $false
    [System.Windows.Forms.Application]::Exit()
  })

$notify.ContextMenuStrip = $menu
$notify.add_MouseDoubleClick({ Start-Process "http://localhost:$AppPort" })

# ── Poll ─────────────────────────────────────────────────────────────────────

$script:lastState = ""

function Update-Icon {
  $state = Get-PeerState
  if ($state -eq $script:lastState) { return }
  $notify.Icon = $icons[$state]
  $notify.Text = $labels[$state]
  # Only a fall FROM working is worth interrupting anyone over. Coming back up
  # is good news that the colour already carries.
  if ($script:lastState -eq "serving" -and $state -eq "down") {
    Show-Balloon "Ledgr stopped" "Nothing is answering on port $AppPort. Right-click this icon to start it."
  }
  $script:lastState = $state
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = [Math]::Max(3, $PollSeconds) * 1000
$timer.add_Tick({ Update-Icon })
$timer.Start()
Update-Icon

try {
  [System.Windows.Forms.Application]::Run()
} finally {
  $timer.Stop()
  $notify.Visible = $false
  $notify.Dispose()
  foreach ($i in $icons.Values) { $i.Dispose() }
}
