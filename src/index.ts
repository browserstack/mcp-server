#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const packageJson = require("../package.json");
import "dotenv/config";
import http from "http";
import { randomUUID } from "crypto";
import logger from "./logger.js";
import { BrowserStackMcpServer } from "./server-factory.js";

async function main() {
  logger.info(
    "Launching BrowserStack MCP server, version %s",
    packageJson.version,
  );

  const remoteMCP = process.env.REMOTE_MCP === "true";
  const username = process.env.BROWSERSTACK_USERNAME;
  const accessKey = process.env.BROWSERSTACK_ACCESS_KEY;

  if (!username) {
    throw new Error("BROWSERSTACK_USERNAME environment variable is required");
  }

  if (!accessKey) {
    throw new Error("BROWSERSTACK_ACCESS_KEY environment variable is required");
  }

  const mcpServer = new BrowserStackMcpServer({
    "browserstack-username": username,
    "browserstack-access-key": accessKey,
  });

  if (remoteMCP) {
    // ── HTTP Transport (Remote MCP) ──────────────────────────────────────
    const port = parseInt(process.env.MCP_PORT || "3100", 10);

    // Create a new transport for each session
    const transports = new Map<string, StreamableHTTPServerTransport>();

    const httpServer = http.createServer(async (req, res) => {
      // CORS headers for browser clients
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id");
      res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url || "/", `http://localhost:${port}`);

      // Health check
      if (url.pathname === "/health" || url.pathname === "/healthz") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", version: packageJson.version }));
        return;
      }

      // MCP endpoint
      if (url.pathname === "/mcp") {
        // Check for existing session
        const sessionId = req.headers["mcp-session-id"] as string | undefined;

        if (sessionId && transports.has(sessionId)) {
          // Existing session — reuse transport
          const transport = transports.get(sessionId)!;
          await transport.handleRequest(req, res);
          return;
        }

        if (req.method === "POST" && !sessionId) {
          // New session — create transport and connect server
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
          });

          transport.onclose = () => {
            if (transport.sessionId) {
              transports.delete(transport.sessionId);
              logger.info("Session closed: %s", transport.sessionId);
            }
          };

          // Connect to a NEW server instance for this session
          const sessionServer = new BrowserStackMcpServer({
            "browserstack-username": username!,
            "browserstack-access-key": accessKey!,
          });

          await sessionServer.getInstance().connect(transport);

          if (transport.sessionId) {
            transports.set(transport.sessionId, transport);
            logger.info("New session: %s", transport.sessionId);
          }

          await transport.handleRequest(req, res);
          return;
        }

        // Invalid request
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid request. POST to /mcp to start a session." }));
        return;
      }

      // Root — info page
      if (url.pathname === "/") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            name: "BrowserStack MCP Server",
            version: packageJson.version,
            endpoint: `http://localhost:${port}/mcp`,
            health: `http://localhost:${port}/health`,
            instructions: "Connect your MCP client to the /mcp endpoint.",
          }),
        );
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    httpServer.listen(port, () => {
      logger.info("Remote MCP server running at http://localhost:%d/mcp", port);
      console.log(`\n🚀 BrowserStack MCP Server (Remote Mode)`);
      console.log(`   Version: ${packageJson.version}`);
      console.log(`   Endpoint: http://localhost:${port}/mcp`);
      console.log(`   Health: http://localhost:${port}/health`);
      console.log(`\n   Connect from any MCP client using the endpoint URL above.`);
      console.log(`   In VS Code: Add MCP Server → HTTP → http://localhost:${port}/mcp`);
      console.log(`   In Claude Code: /mcp add http://localhost:${port}/mcp\n`);
    });
  } else {
    // ── Stdio Transport (Local MCP — default) ────────────────────────────
    const transport = new StdioServerTransport();
    await mcpServer.getInstance().connect(transport);
  }
}

main().catch(console.error);

// Ensure logs are flushed before exit
process.on("exit", () => {
  logger.flush();
});

export { setLogger } from "./logger.js";
export { BrowserStackMcpServer } from "./server-factory.js";
export { trackMCP } from "./lib/instrumentation.js";
export const PackageJsonVersion = packageJson.version;
