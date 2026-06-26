#!/usr/bin/env bash
# scaffold.sh — drop the .genesis/ spine into a target repo.
# Usage:  ./tools/scaffold.sh <target-repo> [project-name]
set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-}"
PROJECT="${2:-$(basename "${TARGET:-project}")}"

if [[ -z "$TARGET" ]]; then echo "usage: ./tools/scaffold.sh <target-repo> [project-name]"; exit 1; fi
if [[ ! -d "$TARGET" ]]; then echo "target repo does not exist: $TARGET"; exit 1; fi

DEST="$TARGET/.genesis"
if [[ -d "$DEST" ]]; then
  echo "⚠️  $DEST already exists. Refusing to overwrite. Remove it first or scaffold elsewhere."; exit 1
fi

cp -R "$KIT_DIR/templates/.genesis" "$DEST"
# carry the adapter doc in-repo so the spine is self-describing
cp "$KIT_DIR/AGENT-ADAPTERS.md" "$DEST/AGENT-ADAPTERS.md"
cp "$KIT_DIR/genesis.md"        "$DEST/genesis.md"

# light placeholder seed (project name + date); the rest is filled during the genesis ritual
TODAY="$(date +%Y-%m-%d)"
find "$DEST" -type f \( -name '*.md' -o -name '*.html' -o -name '*.json' \) -print0 \
  | xargs -0 sed -i.bak -e "s/{{PROJECT_NAME}}/$PROJECT/g" -e "s/{{DATE}}/$TODAY/g"
find "$DEST" -name '*.bak' -delete

echo "✅ scaffolded $DEST"
echo "   next:"
echo "   1. node $KIT_DIR/tools/graphizer.mjs \"$TARGET\" --write   # build context-graph.json"
echo "   2. open $DEST/genesis.md and run G0-G6"
echo "   3. fill remaining {{PLACEHOLDERS}} in DONE.html / PLAN.md / KICKOFF.md"
