#!/usr/bin/env bash
# make-zip.sh — build a self-contained, shippable genesis-kit.zip that VENDORS the agentic-swe-kit,
# so a recipient gets one file: unzip → ./install.sh → works in any agent.
# Usage:  ./make-zip.sh [path-to-agentic-swe-kit]
set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SWE_SRC="${1:-$HOME/Desktop/agentic-swe-kit}"
STAGE="$(mktemp -d)/genesis-kit"
OUT="$KIT_DIR/genesis-kit.zip"

mkdir -p "$STAGE"
# copy the kit (exclude vcs, vendor, prior zips, OS cruft)
rsync -a --exclude '.git' --exclude 'vendor' --exclude 'genesis-kit.zip' \
      --exclude '.DS_Store' --exclude '*.bak' "$KIT_DIR/" "$STAGE/"

# vendor the swe-kit so the bundle is self-contained
if [[ -d "$SWE_SRC" ]]; then
  mkdir -p "$STAGE/vendor"
  rsync -a --exclude '.git' --exclude '.obsidian' --exclude '.DS_Store' "$SWE_SRC/" "$STAGE/vendor/agentic-swe-kit/"
  echo "✅ vendored agentic-swe-kit from $SWE_SRC"
else
  echo "⚠️  $SWE_SRC not found — bundle will clone the swe-kit at install time instead of vendoring."
fi

chmod +x "$STAGE/install.sh" "$STAGE/make-zip.sh" "$STAGE/tools/scaffold.sh" 2>/dev/null || true

( cd "$(dirname "$STAGE")" && zip -rq "$OUT" "genesis-kit" )
echo "✅ built $OUT"
echo "   ship it. recipient: unzip genesis-kit.zip && cd genesis-kit && ./install.sh"
