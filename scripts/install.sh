#!/bin/sh
# Ledgr for Mac and Linux: install, upgrade in place, or uninstall, for this
# user only. No sudo, no administrator password (install plan step 8).
#
#   Install or upgrade:  curl -fsSL https://github.com/strategicli/ledgr/releases/latest/download/install.sh | sh
#   Uninstall:           curl -fsSL https://github.com/strategicli/ledgr/releases/latest/download/install.sh | sh -s -- --uninstall
#
# This file is a template. The package workflow fills in one release's version,
# channel, download address and the sha256 of each Mac and Linux archive
# (supervisor/release.mjs renderInstallScript) and publishes it beside them.
# A download that does not match its sha256 is refused.
#
# Where things go:
#   Mac:   ~/Library/Application Support/Ledgr/app   (the program, replaced on upgrade)
#          ~/Library/Application Support/Ledgr/data  (your data, kept unless you say otherwise)
#   Linux: ~/.local/share/ledgr/app and ~/.local/share/ledgr/data
#
# Everything that needs a decision (ports, another Ledgr on this computer, what
# to keep on an upgrade, what to stop) is supervisor/installer.mjs, run with the
# package's own Node, exactly as the Windows installer runs it. See runbook §1u.
set -eu

VERSION="__LEDGR_VERSION__"
CHANNEL="__LEDGR_CHANNEL__"
BASE="__LEDGR_BASE__"
SUMS="__LEDGR_SUMS__"

say() { printf '%s\n' "$*"; }
die() {
  printf '\nLedgr was not installed: %s\n' "$*" >&2
  exit 1
}

case "$VERSION" in *LEDGR*) die "this is the unfilled template. Download install.sh from a Ledgr release instead." ;; esac

case "$(uname -s)" in
  Darwin)
    os=macos
    ROOT="$HOME/Library/Application Support/Ledgr"
    ;;
  Linux)
    os=linux
    ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/ledgr"
    ;;
  *) die "this script is for a Mac or Linux. On Windows, download Ledgr-Setup.exe instead." ;;
esac
APP="$ROOT/app"
DATA="$ROOT/data"
NODE="$APP/node/bin/node"
HELPER="$APP/supervisor/installer.mjs"

# ── Uninstall ────────────────────────────────────────────────────────────────
if [ "${1:-}" = "--uninstall" ]; then
  [ -x "$NODE" ] || die "Ledgr is not installed for this user (nothing at $APP)."
  say "Stopping Ledgr and removing the program..."
  "$NODE" "$HELPER" uninstall --app "$APP" --data "$DATA" || true
  rm -rf "$APP"
  say "The Ledgr program is removed."
  # The one question, asked only at a keyboard (curl | sh reads the script
  # from a pipe, so answers come from the terminal). No answer keeps the data.
  answer=""
  if [ -d "$DATA" ] && (: </dev/tty) 2>/dev/null; then
    exec 3</dev/tty
    say ""
    say "Your notes, tasks, files and backups are still in:"
    say "  $DATA"
    printf 'Also delete all of them from this computer? This cannot be undone. Type DELETE to delete, or press Enter to keep them: '
    read -r answer <&3 || answer=""
    if [ "$answer" = "DELETE" ]; then
      printf 'Are you sure? Everything in that folder will be gone for good. [y/N] '
      read -r sure <&3 || sure=""
      case "$sure" in y | Y | yes | YES) ;; *) answer="" ;; esac
    fi
    exec 3<&-
  fi
  if [ "$answer" = "DELETE" ]; then
    rm -rf "$DATA"
    rmdir "$ROOT" 2>/dev/null || true
    say "Your Ledgr data is deleted."
  elif [ -d "$DATA" ]; then
    say "Your data is kept in $DATA. Installing Ledgr again brings it back."
  fi
  exit 0
fi

# ── Which package ────────────────────────────────────────────────────────────
cpu=$(uname -m)
# A Terminal running under Rosetta reports x86_64 on an Apple-silicon Mac.
if [ "$os" = macos ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = 1 ]; then cpu=arm64; fi
case "$cpu" in
  arm64 | aarch64) cpu=arm64 ;;
  x86_64 | amd64) cpu=x64 ;;
  *) die "there is no Ledgr package for this processor ($cpu) yet." ;;
esac
key="$os-$cpu"
entry=$(printf '%s\n' "$SUMS" | awk -v k="$key" '$1 == k { print $2 " " $3 }')
[ -n "$entry" ] || die "there is no Ledgr package for $key yet. Packages exist for Macs (Apple silicon and Intel) and 64-bit Intel/AMD Linux."
file=${entry% *}
sum=${entry#* }

if [ "$os" = linux ]; then
  glibc=$(getconf GNU_LIBC_VERSION 2>/dev/null | awk '{ print $2 }')
  [ -n "$glibc" ] || die "Ledgr needs a Linux built on glibc (Ubuntu, Debian, Fedora and most others; not Alpine)."
  awk -v v="$glibc" 'BEGIN { split(v, a, "."); exit !(a[1] > 2 || (a[1] == 2 && a[2] >= 34)) }' ||
    die "Ledgr needs glibc 2.34 or newer (Ubuntu 22.04, Debian 12, Fedora 36 or later); this computer has $glibc."
fi
command -v curl >/dev/null 2>&1 || die "curl is missing. Install it and run this again."
command -v tar >/dev/null 2>&1 || die "tar is missing. Install it and run this again."

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{ print $1 }'
  else
    die "no sha256 tool (sha256sum or shasum) to check the download with."
  fi
}

# Never go backwards: an older package over a newer install would put old code
# in front of a database the newer one already migrated.
fresh=yes
[ -f "$DATA/config.json" ] && fresh=no
if [ -f "$APP/ledgr-package.json" ]; then
  installed=$(sed -n 's/.*"version": *"\([0-9.]*\)".*/\1/p' "$APP/ledgr-package.json" | head -n 1)
  if [ -n "$installed" ] && awk -v a="$installed" -v b="$VERSION" 'BEGIN { exit !(a > b) }'; then
    die "a newer Ledgr ($installed) is already installed, so this older one ($VERSION) will not replace it. Ledgr updates itself from Build > Updates."
  fi
fi

# ── Download, check, unpack (the running copy is untouched until this works) ─
mkdir -p "$ROOT"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/ledgr-install.XXXXXX")
trap 'rm -rf "$tmp" "$ROOT/app.new"' EXIT
say "Downloading Ledgr $VERSION ($CHANNEL) for $key..."
curl -fL --progress-bar -o "$tmp/$file" "$BASE/$file" || die "the download failed. Check the internet connection and run this again."
got=$(sha256 "$tmp/$file")
[ "$got" = "$sum" ] || die "the download does not match its checksum (got $got, expected $sum), so it was thrown away. Run this again; if it keeps happening, tell whoever sent you the link."
say "Checksum matches."
rm -rf "$ROOT/app.new"
mkdir -p "$ROOT/app.new"
tar -xf "$tmp/$file" -C "$ROOT/app.new" || die "the download could not be unpacked."
grep -q "\"version\": *\"$VERSION\"" "$ROOT/app.new/ledgr-package.json" 2>/dev/null ||
  die "the unpacked package does not say it is version $VERSION."

# ── Swap it in ───────────────────────────────────────────────────────────────
if [ -x "$NODE" ] && [ -f "$HELPER" ]; then
  say "Stopping the Ledgr that is running now..."
  "$NODE" "$HELPER" stop --app "$APP" --data "$DATA" || true
fi
rm -rf "$APP"
mv "$ROOT/app.new" "$APP"

say "Setting up..."
"$NODE" "$HELPER" prepare --app "$APP" --data "$DATA" --channel "$CHANNEL" ||
  die "setting it up failed. What happened is in $DATA/install.log."
"$NODE" "$HELPER" launchers --app "$APP" --data "$DATA" || true
say "Starting Ledgr. The first start takes a minute or two..."
if ! "$NODE" "$HELPER" start --data "$DATA"; then
  say "Ledgr is installed but has not finished starting yet. Give it a minute, then open Ledgr."
  say "If it still does not open, its log is in $DATA/supervisor.log."
  exit 1
fi

say ""
if [ "$fresh" = yes ]; then
  "$NODE" "$HELPER" open --data "$DATA" --setup || true
  say "Ledgr is installed and running. Your browser is opening its setup page, where you make your sign-in."
else
  "$NODE" "$HELPER" open --data "$DATA" || true
  say "Ledgr is updated to $VERSION and running. Your data is as you left it."
fi
if [ "$os" = macos ]; then
  say "Open it any time: Ledgr in your Applications > Ledgr folder (or Spotlight: Ledgr)."
else
  say "Open it any time: Ledgr in your applications menu."
fi
say "It starts by itself when you sign in. Change that in Ledgr: Build > Updates > Start with the computer."
