# BrowserStack MCP Server: install guide for AI agents

This file is for AI coding agents (Cline, Cursor, Kiro, Claude, Copilot, etc.) that set up MCP servers on a user's behalf. It contains only what is needed to install and verify the server. Human-facing docs are in [README.md](README.md).

## What this server does

Exposes BrowserStack's Test Platform as MCP tools: run and debug tests on real browsers and devices, start manual Live and App Live sessions, scan for accessibility issues, manage test cases and test runs in Test Management, fetch failure logs and AI root-cause analysis, and run Percy visual tests.

## Prerequisites

- A BrowserStack account. Sign up at https://www.browserstack.com/users/sign_up. Open-source projects can request a free plan at https://www.browserstack.com/open-source.
- For the local (stdio) install only: Node.js 20.9 or newer. Node 22 LTS is recommended. Check with `node --version`.

## Option A: hosted remote server (recommended, no install)

Connect to the hosted Streamable HTTP endpoint. Authentication is OAuth; the client opens a browser window for the user to sign in. No credentials go into config files.

- URL: `https://mcp.browserstack.com/mcp`
- Transport: `streamable-http`
- Auth: OAuth 2.1 with discovery. The endpoint returns `401` with a `WWW-Authenticate` header pointing at `/.well-known/oauth-protected-resource`.

Generic config (Cursor, Claude Desktop, Cline, Windsurf, and most clients):

```json
{
  "mcpServers": {
    "browserstack": {
      "url": "https://mcp.browserstack.com/mcp"
    }
  }
}
```

VS Code (`.vscode/mcp.json`):

```json
{
  "servers": {
    "browserstack": {
      "type": "http",
      "url": "https://mcp.browserstack.com/mcp"
    }
  }
}
```

Kiro (`.kiro/settings/mcp.json`):

```json
{
  "mcpServers": {
    "browserstack": {
      "url": "https://mcp.browserstack.com/mcp",
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

Limitation: the remote server cannot reach the user's localhost or private network, and tools that read local files (app uploads, Percy file scans) are unavailable. Use Option B for those.

## Option B: local server via npx (stdio)

Runs the server as a local process. Requires the user's BrowserStack username and access key, found at https://www.browserstack.com/accounts/profile/details. Never ask the user to paste these into chat; have them edit the config file directly.

Generic config (Cursor `.cursor/mcp.json`, Claude Desktop `claude_desktop_config.json`, Cline MCP settings):

```json
{
  "mcpServers": {
    "browserstack": {
      "command": "npx",
      "args": ["-y", "@browserstack/mcp-server@latest"],
      "env": {
        "BROWSERSTACK_USERNAME": "<username>",
        "BROWSERSTACK_ACCESS_KEY": "<access_key>"
      }
    }
  }
}
```

VS Code (`.vscode/mcp.json`):

```json
{
  "servers": {
    "browserstack": {
      "command": "npx",
      "args": ["-y", "@browserstack/mcp-server@latest"],
      "env": {
        "BROWSERSTACK_USERNAME": "<username>",
        "BROWSERSTACK_ACCESS_KEY": "<access_key>"
      }
    }
  }
}
```

Kiro (`.kiro/settings/mcp.json`):

```json
{
  "mcpServers": {
    "browserstack": {
      "command": "npx",
      "args": ["-y", "@browserstack/mcp-server@latest"],
      "env": {
        "BROWSERSTACK_USERNAME": "<username>",
        "BROWSERSTACK_ACCESS_KEY": "<access_key>"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

Optional environment variables for the local server:

| Variable | Purpose |
| --- | --- |
| `MCP_UPLOAD_BASE_DIR` | Directory that file-upload tools (`uploadProductRequirementFile`, `takeAppScreenshot`, `runAppTestsOnBrowserStack`, `runAppLiveSession`) may read from. Uploads are restricted to this directory. |
| `BROWSERSTACK_LOCAL_OPTION_<KEY>` | Passes an option to the BrowserStack Local tunnel, e.g. `BROWSERSTACK_LOCAL_OPTION_PROXYHOST`. Only needed when testing sites behind a firewall or on localhost. |

## Verify the install

1. Restart or reload the MCP client so it starts the server.
2. Confirm the `browserstack` server shows as connected and lists tools such as `runBrowserLiveSession`, `startAccessibilityScan`, `listTestCases`, and `getFailureLogs`.
3. Smoke test with a prompt that needs no project setup, for example: "Start an accessibility scan of https://www.browserstack.com and summarise the top issues." A successful call returns a scan ID and a link into the BrowserStack dashboard.

## Troubleshooting

- `401` or OAuth loop on the remote server: the user must complete the sign-in in the browser window the client opens. If the client does not support OAuth, use Option B.
- Local server fails to start: check `node --version` is 20.9 or newer, and that both env vars are set with no surrounding quotes or whitespace.
- Tools missing from the list: some clients cap the number of tools they load. The server exposes about 50 tools; if the client has a limit, disable other servers or use its tool filter.
- Further help: https://github.com/browserstack/mcp-server/issues

## Links

- npm: https://www.npmjs.com/package/@browserstack/mcp-server
- Source: https://github.com/browserstack/mcp-server
- MCP Registry name: `io.github.browserstack/mcp-server`
- Licence: AGPL-3.0
