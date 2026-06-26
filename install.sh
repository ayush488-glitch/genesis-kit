#!/usr/bin/env bash
# install.sh — install the Genesis kit + the agentic-swe-kit into every agent found on this machine.
# Agent-agnostic: detects Hermes, Claude Code, and Codex skill dirs and installs into each.
# Usage:  ./install.sh
set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "▶ Genesis kit at: $KIT_DIR"

# ── 1. Install / locate the agentic-swe-kit (the knowledge graph + orchestrator) ───────────────
SWE_KIT=""
for cand in "$KIT_DIR/vendor/agentic-swe-kit" "$HOME/Desktop/agentic-swe-kit" "$KIT_DIR/../agentic-swe-kit"; do
  if [[ -d "$cand" ]]; then SWE_KIT="$cand"; break; fi
done
if [[ -z "$SWE_KIT" ]]; then
  echo "… agentic-swe-kit not found locally; cloning"
  git clone https://github.com/ayush488-glitch/agentic-swe-kit "$KIT_DIR/vendor/agentic-swe-kit" 2>/dev/null \
    && SWE_KIT="$KIT_DIR/vendor/agentic-swe-kit" \
    || echo "⚠️  could not clone agentic-swe-kit — install it manually and re-run."
fi
if [[ -n "$SWE_KIT" && -x "$SWE_KIT/install.sh" ]]; then
  echo "▶ running agentic-swe-kit installer"
  (cd "$SWE_KIT" && ./install.sh) || echo "⚠️  swe-kit installer returned non-zero; continuing."
fi

# ── 2. Detect agent skill directories ──────────────────────────────────────────────────────────
TARGETS=()
[[ -d "$HOME/.hermes" ]] && TARGETS+=("$HOME/.hermes/skills")
[[ -d "$HOME/.claude" ]] && TARGETS+=("$HOME/.claude/skills")
[[ -d "$HOME/.codex"  ]] && TARGETS+=("$HOME/.codex/skills")
if [[ ${#TARGETS[@]} -eq 0 ]]; then
  echo "… no agent dirs found (~/.hermes, ~/.claude, ~/.codex). Installing to ~/.claude/skills as default."
  TARGETS+=("$HOME/.claude/skills")
fi

# ── 3. Install the genesis skill into each agent ────────────────────────────────────────────────
for dir in "${TARGETS[@]}"; do
  mkdir -p "$dir/genesis"
  cp "$KIT_DIR/skills/genesis/SKILL.md" "$dir/genesis/SKILL.md"
  echo "✅ genesis skill → $dir/genesis"
done

# ── 4. Export the kit root so scaffold.sh / graphizer are findable ──────────────────────────────
SHELL_RC="$HOME/.zshrc"; [[ "${SHELL:-}" == *bash* ]] && SHELL_RC="$HOME/.bashrc"
LINE="export GENESIS_KIT_ROOT=\"$KIT_DIR\""
grep -qsF "$LINE" "$SHELL_RC" 2>/dev/null || { echo "$LINE" >> "$SHELL_RC"; echo "✅ set GENESIS_KIT_ROOT in $SHELL_RC"; }

cat <<EOF

────────────────────────────────────────────────────────
✅ Genesis kit installed.

Start a project in any agent:
  1.  cd <your-project>
  2.  "$KIT_DIR/tools/scaffold.sh" .            # drops .genesis/ spine
  3.  node "$KIT_DIR/tools/graphizer.mjs" . --write   # builds context-graph
  4.  invoke the 'genesis' skill and run G0–G6 (see .genesis/genesis.md)

Restart your shell (or: source $SHELL_RC) so GENESIS_KIT_ROOT is set.
────────────────────────────────────────────────────────
EOF
