#!/usr/bin/env bash
# scaffold.sh — drop the .genesis/ spine into a target repo.
# Usage:  ./tools/scaffold.sh <target-repo> [project-name]
#   Optional flags (asked interactively if omitted):
#     --cheap-model    <id>   e.g. claude-haiku-4-5
#     --flagship-model <id>   e.g. claude-opus-4-5
#     --router-skill   <name> e.g. coding-orchestrator
#     --budget         <n>    token budget per milestone, e.g. 50000
#     --max-iters      <n>    max loop iterations per milestone, e.g. 10
set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-}"
PROJECT="${2:-$(basename "${TARGET:-project}")}"

# ── parse optional named flags ────────────────────────────────────────────────
CHEAP_MODEL=""
FLAGSHIP_MODEL=""
ROUTER_SKILL=""
MILESTONE_BUDGET=""
MAX_ITERS=""

shift 2 2>/dev/null || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cheap-model)    CHEAP_MODEL="$2";    shift 2 ;;
    --flagship-model) FLAGSHIP_MODEL="$2"; shift 2 ;;
    --router-skill)   ROUTER_SKILL="$2";   shift 2 ;;
    --budget)         MILESTONE_BUDGET="$2"; shift 2 ;;
    --max-iters)      MAX_ITERS="$2";      shift 2 ;;
    *) echo "unknown flag: $1"; exit 1 ;;
  esac
done

if [[ -z "$TARGET" ]]; then echo "usage: ./tools/scaffold.sh <target-repo> [project-name]"; exit 1; fi
if [[ ! -d "$TARGET" ]]; then echo "target repo does not exist: $TARGET"; exit 1; fi

# ── interactive prompts for model names if not supplied via flags ─────────────
echo ""
echo "━━━ Model configuration ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "These fill {{CHEAP_MODEL}} and {{FLAGSHIP_MODEL}} in LOOPS.md, CURRENT.md,"
echo "and DONE.html so you don't have placeholder tokens left in your spine."
echo ""

if [[ -z "$CHEAP_MODEL" ]]; then
  echo -n "  Cheap / driver model  (default: claude-haiku-4-5) → "; read -r _in
  CHEAP_MODEL="${_in:-claude-haiku-4-5}"
fi

if [[ -z "$FLAGSHIP_MODEL" ]]; then
  echo -n "  Flagship / checker model (default: claude-opus-4-5) → "; read -r _in
  FLAGSHIP_MODEL="${_in:-claude-opus-4-5}"
fi

if [[ -z "$ROUTER_SKILL" ]]; then
  echo -n "  Router skill name     (default: coding-orchestrator)  → "; read -r _in
  ROUTER_SKILL="${_in:-coding-orchestrator}"
fi

if [[ -z "$MILESTONE_BUDGET" ]]; then
  echo -n "  Token budget per milestone (default: 50000)           → "; read -r _in
  MILESTONE_BUDGET="${_in:-50000}"
fi

if [[ -z "$MAX_ITERS" ]]; then
  echo -n "  Max loop iterations per milestone (default: 10)       → "; read -r _in
  MAX_ITERS="${_in:-10}"
fi

echo ""
echo "  cheap_model      = $CHEAP_MODEL"
echo "  flagship_model   = $FLAGSHIP_MODEL"
echo "  router_skill     = $ROUTER_SKILL"
echo "  milestone_budget = $MILESTONE_BUDGET tokens"
echo "  max_iters        = $MAX_ITERS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

DEST="$TARGET/.genesis"
if [[ -d "$DEST" ]]; then
  echo "⚠️  $DEST already exists. Refusing to overwrite. Remove it first or scaffold elsewhere."; exit 1
fi

cp -R "$KIT_DIR/templates/.genesis" "$DEST"
# carry the adapter doc in-repo so the spine is self-describing
cp "$KIT_DIR/AGENT-ADAPTERS.md" "$DEST/AGENT-ADAPTERS.md"
cp "$KIT_DIR/genesis.md"        "$DEST/genesis.md"

# ── sed pass: fill all placeholder families ───────────────────────────────────
TODAY="$(date +%Y-%m-%d)"

# escape special chars in model names for sed (handles slashes, dots)
_esc() { printf '%s' "$1" | sed 's/[\/&]/\\&/g'; }

find "$DEST" -type f \( -name '*.md' -o -name '*.html' -o -name '*.json' \) -print0 \
  | xargs -0 sed -i.bak \
      -e "s/{{PROJECT_NAME}}/$(_esc "$PROJECT")/g" \
      -e "s/{{DATE}}/$(_esc "$TODAY")/g" \
      -e "s/{{CHEAP_MODEL}}/$(_esc "$CHEAP_MODEL")/g" \
      -e "s/{{FLAGSHIP_MODEL}}/$(_esc "$FLAGSHIP_MODEL")/g" \
      -e "s/{{ROUTER_SKILL}}/$(_esc "$ROUTER_SKILL")/g" \
      -e "s/{{MILESTONE_BUDGET}}/$(_esc "$MILESTONE_BUDGET")/g" \
      -e "s/{{MAX_ITERS}}/$(_esc "$MAX_ITERS")/g" \
      -e "s/{{DEBUG_MAX_ITERS}}/5/g" \
      -e "s/{{DEBUG_BUDGET}}/20000/g" \
      -e "s/{{RESEARCH_MAX_ITERS}}/5/g" \
      -e "s/{{RESEARCH_BUDGET}}/20000/g" \
      -e "s/{{VERIFY_BUDGET}}/10000/g"
find "$DEST" -name '*.bak' -delete

echo "✅ scaffolded $DEST"
echo "   next:"
echo "   1. node $KIT_DIR/tools/graphizer.mjs \"$TARGET\" --write   # build context-graph.json"
echo "   2. open $DEST/genesis.md and run G0-G6"
echo "   3. fill remaining {{PLACEHOLDERS}} in DONE.html / PLAN.md / KICKOFF.md"
