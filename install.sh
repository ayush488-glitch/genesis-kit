#!/usr/bin/env bash
set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v node >/dev/null || { echo "Genesis requires Node.js 18+." >&2; exit 1; }
node -e 'if (+process.versions.node.split(".")[0] < 18) process.exit(1)' \
  || { echo "Genesis requires Node.js 18+." >&2; exit 1; }

for AGENT_DIR in "$HOME/.codex/skills" "$HOME/.claude/skills"; do
  mkdir -p "$AGENT_DIR/genesis"
  cp "$KIT_DIR/skills/genesis/SKILL.md" "$AGENT_DIR/genesis/SKILL.md"
done

BIN_DIR="${GENESIS_BIN_DIR:-$HOME/.local/bin}"
BIN="$BIN_DIR/genesis"
mkdir -p "$BIN_DIR"
if [[ -e "$BIN" && ! -L "$BIN" ]]; then
  echo "Refusing to replace existing file: $BIN" >&2
  exit 1
fi
if [[ -L "$BIN" && "$(readlink "$BIN")" != "$KIT_DIR/tools/genesis.mjs" ]]; then
  echo "Refusing to replace existing link: $BIN" >&2
  exit 1
fi
ln -sfn "$KIT_DIR/tools/genesis.mjs" "$BIN"

echo "Genesis installed offline."
echo "  CLI: $BIN"
echo "  Skills: $HOME/.codex/skills/genesis and $HOME/.claude/skills/genesis"
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo "  Add $BIN_DIR to PATH, or invoke $BIN directly."
fi
