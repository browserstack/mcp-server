#!/bin/bash
# Percy MCP Server launcher
# Reads credentials from percy-config/config in this directory

DIR="$(cd "$(dirname "$0")" && pwd)"

# Source config
if [ -f "$DIR/config" ]; then
  source "$DIR/config"
fi

# Start MCP server
exec node "$DIR/../dist/index.js" "$@"
