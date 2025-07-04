import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createRequire } from "module";
import "dotenv/config";
import { logger, createMcpServer } from "browserstack-mcp-server";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");

const PORT = process.env.MCP_PORT ? parseInt(process.env.MCP_PORT) : 3000;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(",") || ["*"];

const app = express();

app.use(
  cors({
    origin: ALLOWED_ORIGINS,
    credentials: true,
    exposedHeaders: ["mcp-session-id"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "mcp-session-id",
      "browserstack-username",
      "browserstack-access-key",
    ],
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
  }),
);

app.use(express.json({ limit: "10mb" }));

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    version: packageJson.version,
    timestamp: new Date().toISOString(),
  });
});

// --- Unified MCP Endpoint with Backward Compatibility ---

// This map holds stateful sessions for the legacy SSE transport.
// We store both the server and transport to manage their lifecycle together.
const sseSessions: {
  [sessionId: string]: { transport: SSEServerTransport; server: McpServer };
} = {};

// GET /mcp
// Handles legacy SSE connection initiation (replaces the old /sse endpoint).
// Modern clients may also use GET to open a server-to-client stream.
app.get("/mcp", async (req, res) => {
  logger.info("Received GET /mcp, initiating SSE connection for a client session.");
  try {
    // For backward compatibility, check headers first, then query parameters for credentials.
    const browserstackUsername =
      (req.headers["browserstack-username"] as string | undefined) ||
      (req.query["browserstack-username"] as string | undefined);
    const browserstackAccessKey =
      (req.headers["browserstack-access-key"] as string | undefined) ||
      (req.query["browserstack-access-key"] as string | undefined);

    if (!browserstackUsername || !browserstackAccessKey) {
      logger.warn("Missing BrowserStack credentials in headers or query for SSE connection");
      res.status(401).send("Unauthorized");
      return;
    }

    const server = createMcpServer({
      "browserstack-username": browserstackUsername,
      "browserstack-access-key": browserstackAccessKey,
    }) as McpServer;

    // The transport tells the client to POST messages back to the unified /mcp endpoint.
    const transport = new SSEServerTransport("/mcp", res);
    sseSessions[transport.sessionId] = { transport, server };

    res.on("close", () => {
      logger.info(`SSE connection closed for session: ${transport.sessionId}`);
      // The session may have already been cleaned up by a DELETE request.
      const session = sseSessions[transport.sessionId];
      if (session) {
        session.server.close();
        delete sseSessions[transport.sessionId];
      }
      transport.close(); // transport.close() is idempotent
    });

    await server.connect(transport);
    logger.info(`SSE transport connected for session: ${transport.sessionId}`);
  } catch (error) {
    logger.error("Error handling SSE connection on /mcp:", error);
    if (!res.headersSent) {
      res.status(500).send("Internal Server Error");
    }
  }
});

// POST /mcp
// Handles both modern stateless requests and legacy stateful messages.
app.post("/mcp", async (req, res) => {
  const sessionId = req.query.sessionId as string | undefined;

  // If a sessionId is present, it's a message for a legacy SSE session.
  if (sessionId) {
    logger.info(`Received legacy message for session: ${sessionId}`);
    const session = sseSessions[sessionId];
    if (session) {
      await session.transport.handlePostMessage(req, res, req.body);
    } else {
      logger.warn(`No active transport found for legacy SSE session: ${sessionId}`);
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Session not found or has expired." },
        id: req.body.id || null,
      });
    }
    return;
  }

  // Otherwise, handle it as a modern, stateless Streamable HTTP request.
  logger.info("Received modern stateless MCP POST request");
  try {
    const browserstackUsername =
      (req.headers["browserstack-username"] as string | undefined) ||
      (req.query["browserstack-username"] as string | undefined);
    const browserstackAccessKey =
      (req.headers["browserstack-access-key"] as string | undefined) ||
      (req.query["browserstack-access-key"] as string | undefined);

    if (!browserstackUsername || !browserstackAccessKey) {
      logger.warn("Missing BrowserStack credentials in headers");
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized: Missing BrowserStack credentials" },
        id: req.body.id || null,
      });
      return;
    }

    const server = createMcpServer({
      "browserstack-username": browserstackUsername,
      "browserstack-access-key": browserstackAccessKey,
    }) as McpServer;

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // No session management for stateless requests
    });

    res.on("close", () => {
      logger.info("Request closed, cleaning up stateless transport and server.");
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    logger.error("Error handling stateless MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: req.body.id || null,
      });
    }
  }
});

// DELETE /mcp
// Handles explicit termination of legacy SSE sessions.
app.delete("/mcp", (req, res) => {
    const sessionId = req.query.sessionId as string | undefined;
    if (!sessionId) {
        logger.warn("Received DELETE /mcp without a sessionId.");
        res.status(400).json({
            jsonrpc: "2.0",
            error: { code: -32602, message: "Invalid params: Missing sessionId query parameter" },
            id: null,
        });
        return;
    }

    const session = sseSessions[sessionId];
    if (session) {
        logger.info(`Terminating legacy SSE session via DELETE request: ${sessionId}`);
        session.server.close();
        session.transport.close(); // Closes the underlying response stream, triggering its 'close' event
        delete sseSessions[sessionId]; // Perform authoritative cleanup
        res.status(200).json({ message: "Session terminated successfully." });
    } else {
        logger.warn(`No session found to delete for ID: ${sessionId}`);
        res.status(404).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Session not found." },
            id: null,
        });
    }
});

// Global error handler
// It MUST have 4 arguments to be recognized by Express as an error handler.
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error("Express global error handler caught an error:", err);
  if (!res.headersSent) {
    res.status(500).json({
      jsonrpc: "2.0",
      error: { code: -32603, message: "Internal server error" },
      id: null,
    });
  } else {
    // If headers are already sent, we can't send a new response.
    // We pass the error to the default Express error handler to terminate the connection.
    next(err);
  }
});

async function startServer() {
  try {
    const server = app.listen(PORT, () => {
      logger.info(
        `BrowserStack MCP HTTP Server v${packageJson.version} listening on port ${PORT}`
      );
      logger.info(`Health check available at: http://localhost:${PORT}/health`);
      logger.info(
        `Unified MCP endpoint available at: http://localhost:${PORT}/mcp`
      );
      logger.info(
        "-> Supports modern Streamable HTTP and legacy HTTP+SSE clients."
      );
      logger.info(`Allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
    });

    const shutdown = (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      // Close all active SSE sessions
      Object.keys(sseSessions).forEach(sessionId => {
        const session = sseSessions[sessionId];
        logger.info(`Closing active session during shutdown: ${sessionId}`);
        session.server.close();
        session.transport.close();
      });

      server.close(() => {
        logger.info("HTTP server closed.");
        process.exit(0);
      });
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

process.on("exit", () => {
  logger.flush();
});

startServer().catch((error) => {
  logger.error("Uncaught error during server startup:", error);
  process.exit(1);
});