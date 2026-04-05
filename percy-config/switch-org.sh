#!/bin/bash
# Quick org switcher for Percy MCP
# Usage: ./switch-org.sh org1   (switches to org1 profile)
#        ./switch-org.sh        (shows current config)

DIR="$(cd "$(dirname "$0")" && pwd)"
PROFILES_DIR="$DIR/profiles"

if [ -z "$1" ]; then
  echo "Current Percy config:"
  echo "──────────────────────"
  grep -v "^#" "$DIR/config" | grep -v "^$" | sed 's/export /  /' | sed 's/=/ = /'
  echo ""
  echo "Available profiles:"
  if [ -d "$PROFILES_DIR" ]; then
    ls "$PROFILES_DIR" 2>/dev/null | sed 's/^/  /'
  else
    echo "  (none — create profiles in percy-config/profiles/)"
  fi
  echo ""
  echo "Usage: ./switch-org.sh <profile-name>"
  exit 0
fi

PROFILE="$PROFILES_DIR/$1"

if [ ! -f "$PROFILE" ]; then
  echo "Profile '$1' not found at $PROFILE"
  echo ""
  echo "Create it:"
  echo "  mkdir -p $PROFILES_DIR"
  echo "  cp $DIR/config $PROFILE"
  echo "  # Edit $PROFILE with your credentials"
  exit 1
fi

cp "$PROFILE" "$DIR/config"
echo "Switched to profile: $1"
echo "Restart Claude Code to pick up changes."
