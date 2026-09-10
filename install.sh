#!/usr/bin/env bash
set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v node >/dev/null || { echo "Genesis requires Node.js 18+." >&2; exit 1; }
node -e 'if (+process.versions.node.split(".")[0] < 18) process.exit(1)' \
  || { echo "Genesis requires Node.js 18+." >&2; exit 1; }

for AGENT_DIR in "$HOME/.codex/skills" "$HOME/.claude/skills"; do
  for SKILL in genesis ponytail; do
    mkdir -p "$AGENT_DIR/$SKILL"
    cp "$KIT_DIR/skills/$SKILL/SKILL.md" "$AGENT_DIR/$SKILL/SKILL.md"
  done
done

BIN_DIR="${GENESIS_BIN_DIR:-$HOME/.local/bin}"
BIN="$BIN_DIR/genesis"
TARGET="$KIT_DIR/tools/genesis.mjs"
MARKER="# installed by genesis-kit install.sh"
mkdir -p "$BIN_DIR"
if [[ -L "$BIN" && "$(readlink "$BIN")" != "$TARGET" ]]; then
  echo "Refusing to replace existing link: $BIN" >&2
  exit 1
fi
if [[ -e "$BIN" && ! -L "$BIN" ]] && ! grep -qF "$MARKER" "$BIN" 2>/dev/null; then
  echo "Refusing to replace existing file: $BIN" >&2
  exit 1
fi
ln -sfn "$TARGET" "$BIN" 2>/dev/null || true
# genesis.mjs imports its siblings from tools/, so the entry point has to resolve back into the
# kit. Where symlinks are unavailable ln -s copies the file instead of failing, and the detached
# copy dies on its first import; write a shim in that case rather than ship the broken copy.
if [[ ! -L "$BIN" ]]; then
  rm -f "$BIN"
  printf '#!/usr/bin/env bash
%s
exec node "%s" "$@"
' "$MARKER" "$TARGET" > "$BIN"
  chmod +x "$BIN"
fi

echo "Genesis installed offline."
echo "  CLI: $BIN"
echo "  Skills: Genesis + Ponytail for Codex and Claude Code"
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo "  Add $BIN_DIR to PATH, or invoke $BIN directly."
fi
