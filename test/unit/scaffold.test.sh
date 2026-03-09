#!/usr/bin/env bash
# Drift test: verifies files embedded in scaffold.md match source templates.
# Fails if they diverge — update scaffold.md when you update a template.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/../.."
SCAFFOLD="$ROOT/src/workflows/scaffold.md"
SCRIPTS="$ROOT/src/templates/scripts"
ENVS="$ROOT/src/templates"

PASS=0
FAIL=0
ERRORS=()

# Extract a ```bash block from scaffold.md by its 1-based occurrence index.
extract_bash_block() {
  local file="$1"
  local target="$2"
  local count=0
  local inside=0
  while IFS= read -r line; do
    if [ "$inside" -eq 0 ] && [[ "$line" == '```bash' ]]; then
      count=$((count + 1))
      if [ "$count" -eq "$target" ]; then
        inside=1
      fi
    elif [ "$inside" -eq 1 ]; then
      if [[ "$line" == '```' ]]; then
        return
      fi
      printf '%s\n' "$line"
    fi
  done < "$file"
}

# Extract a plain ``` block from scaffold.md that starts with a given comment line.
# Searches only within the '## .env.example files' section.
extract_env_block() {
  local file="$1"
  local start_comment="$2"
  python3 - "$file" "$start_comment" << 'PYEOF'
import sys
content = open(sys.argv[1]).read()
marker_comment = sys.argv[2]
section_start = content.find("## .env.example files")
if section_start == -1:
    sys.exit(1)
section = content[section_start:]
needle = "```\n" + marker_comment
idx = section.find(needle)
if idx == -1:
    sys.exit(1)
content_start = idx + 4
block_end = section.find("\n```", content_start)
if block_end == -1:
    sys.exit(1)
# Strip trailing newline added by template files (command substitution strips it anyway)
print(section[content_start:block_end], end="")
PYEOF
}

check_bash() {
  local label="$1"
  local block_index="$2"
  local template="$3"

  local extracted source
  extracted="$(extract_bash_block "$SCAFFOLD" "$block_index")"
  source="$(cat "$SCRIPTS/$template")"

  if [ "$extracted" = "$source" ]; then
    echo "  ✓  $label"
    PASS=$((PASS + 1))
  else
    echo "  ✗  $label — scaffold.md bash block $block_index differs from src/templates/scripts/$template"
    ERRORS+=("$label")
    FAIL=$((FAIL + 1))
    diff <(echo "$extracted") <(echo "$source") | head -30 || true
  fi
}

check_env() {
  local label="$1"
  local start_comment="$2"
  local template="$3"

  local extracted source
  extracted="$(extract_env_block "$SCAFFOLD" "$start_comment")"
  source="$(cat "$ENVS/$template")"
  # Strip trailing newline (command substitution does this; do it to source too for fair compare)
  source="${source%$'\n'}"

  if [ "$extracted" = "$source" ]; then
    echo "  ✓  $label"
    PASS=$((PASS + 1))
  else
    echo "  ✗  $label — scaffold.md .env block differs from src/templates/$template"
    ERRORS+=("$label")
    FAIL=$((FAIL + 1))
    diff <(echo "$extracted") <(echo "$source") | head -30 || true
  fi
}

echo ""
echo "scaffold.md drift tests"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "Shell scripts:"
# Bash block indices in scaffold.md (1-based):
#   1 = Server Health Check Pattern (not a script file — skip)
#   2 = clancy-once.sh (Jira)
#   3 = clancy-once-github.sh (GitHub Issues)
#   4 = clancy-once-linear.sh (Linear)
#   5 = clancy-afk.sh
check_bash "clancy-once.sh (Jira)"          2 "clancy-once.sh"
check_bash "clancy-once-github.sh (GitHub)" 3 "clancy-once-github.sh"
check_bash "clancy-once-linear.sh (Linear)" 4 "clancy-once-linear.sh"
check_bash "clancy-afk.sh"                  5 "clancy-afk.sh"

echo ""
echo ".env.example files:"
check_env ".env.example.jira"   "# Clancy — Jira configuration"         ".env.example.jira"
check_env ".env.example.github" "# Clancy — GitHub Issues configuration" ".env.example.github"
check_env ".env.example.linear" "# Clancy — Linear configuration"        ".env.example.linear"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  $PASS passed, $FAIL failed"
echo ""

if [ "${#ERRORS[@]}" -gt 0 ]; then
  echo "FAIL — scaffold.md is out of sync with source templates."
  echo "Update the embedded blocks in src/workflows/scaffold.md to match."
  exit 1
fi

echo "OK"
