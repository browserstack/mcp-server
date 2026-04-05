#!/bin/bash
# Percy MCP Server launcher
# Reads credentials from percy-config/config

DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$DIR/config"

if [ ! -f "$CONFIG" ]; then
  echo "Percy MCP: No config found. Run setup first:" >&2
  echo "  cd $(dirname "$DIR") && ./percy-config/setup.sh" >&2

  # Still start the server — tools will show auth errors
  exec node "$DIR/../dist/index.js" "$@"
fi

source "$CONFIG"
exec node "$DIR/../dist/index.js" "$@"
