#!/usr/bin/env bash
# Compatibility shim for the pre-v2 scaffold command.
set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-}"

if [[ -z "$TARGET" ]]; then
  echo "usage: scaffold.sh <target-repo> [project-name] [options]" >&2
  exit 2
fi
shift

ARGS=(init "$TARGET")
if [[ $# -gt 0 && "$1" != --* ]]; then
  ARGS+=(--name "$1")
  shift
fi

# Old configuration flags controlled removed prompt/loop machinery. Accept them
# so existing scripts keep working, but do not persist dead configuration.
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cheap-model|--flagship-model|--router-skill|--budget|--max-iters|--explain-diff)
      [[ $# -ge 2 ]] || { echo "missing value for $1" >&2; exit 2; }
      shift 2
      ;;
    --name|--objective|--profile|--constraint|--non-goal|--trust-boundary)
      [[ $# -ge 2 ]] || { echo "missing value for $1" >&2; exit 2; }
      ARGS+=("$1" "$2")
      shift 2
      ;;
    *)
      echo "unknown option: $1" >&2
      exit 2
      ;;
  esac
done

exec node "$KIT_DIR/tools/genesis.mjs" "${ARGS[@]}"
