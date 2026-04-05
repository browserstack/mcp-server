#!/bin/bash
# Switch between saved Percy org profiles
#
# Usage:
#   ./switch-org.sh           # show current + available profiles
#   ./switch-org.sh my-org    # switch to 'my-org' profile
#   ./switch-org.sh --save    # save current config as a profile

DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$DIR/config"
PROFILES="$DIR/profiles"

mkdir -p "$PROFILES"

# Show current config
show_current() {
  echo "Current Percy config:"
  echo "─────────────────────"
  if [ -f "$CONFIG" ]; then
    grep -v "^#" "$CONFIG" | grep -v "^$" | while read -r line; do
      # Mask token values
      key=$(echo "$line" | sed 's/export //' | cut -d= -f1)
      val=$(echo "$line" | cut -d'"' -f2)
      if [ ${#val} -gt 8 ]; then
        masked="${val:0:4}****${val: -4}"
      else
        masked="****"
      fi
      echo "  $key = $masked"
    done
  else
    echo "  (not configured — run setup.sh)"
  fi
  echo ""
}

# List profiles
list_profiles() {
  echo "Available profiles:"
  if [ "$(ls -A "$PROFILES" 2>/dev/null)" ]; then
    ls "$PROFILES" | sed 's/^/  /'
  else
    echo "  (none)"
    echo "  Save one: ./switch-org.sh --save my-org-name"
  fi
  echo ""
}

# No args — show status
if [ -z "$1" ]; then
  show_current
  list_profiles
  echo "Usage:"
  echo "  ./switch-org.sh <profile>     # switch to a profile"
  echo "  ./switch-org.sh --save <name> # save current as profile"
  exit 0
fi

# Save mode
if [ "$1" = "--save" ]; then
  if [ -z "$2" ]; then
    echo "Usage: ./switch-org.sh --save <profile-name>"
    exit 1
  fi
  if [ ! -f "$CONFIG" ]; then
    echo "No config to save. Run setup.sh first."
    exit 1
  fi
  cp "$CONFIG" "$PROFILES/$2"
  echo "✓ Saved current config as profile: $2"
  exit 0
fi

# Switch mode
PROFILE="$PROFILES/$1"
if [ ! -f "$PROFILE" ]; then
  echo "Profile '$1' not found."
  echo ""
  list_profiles
  echo "Create it: ./switch-org.sh --save $1"
  exit 1
fi

cp "$PROFILE" "$CONFIG"
echo "✓ Switched to profile: $1"
echo "  Restart Claude Code to apply."
