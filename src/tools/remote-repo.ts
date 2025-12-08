// src/tools/remote-repo.ts

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrowserStackConfig } from "../lib/types.js";
import { setupRemoteRepoMCP } from "../repo/repo-setup.js";
import logger from "../logger.js";

/**
 * Adds remote repository tools (if configured)
 */
export default function addRemoteRepoTools(
  server: McpServer,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _config: BrowserStackConfig,
): Record<string, any> {
  const tools: Record<string, any> = {};

  // Check if GitHub token is configured
  const githubToken = process.env.GITHUB_TOKEN;
  const repoOwner = process.env.GITHUB_REPO_OWNER;
  const repoName = process.env.GITHUB_REPO_NAME;
  const repoBranch = process.env.GITHUB_REPO_BRANCH || "main";

  if (!githubToken || !repoOwner || !repoName) {
    logger.info(
      "Remote repository integration not configured. Skipping remote repo tools.",
    );
    return tools;
  }

  logger.info(
    "Setting up remote repository integration for %s/%s (branch: %s)",
    repoOwner,
    repoName,
    repoBranch,
  );

  // Set up remote repo asynchronously
  setupRemoteRepoMCP({
    owner: repoOwner,
    repo: repoName,
    branch: repoBranch,
    token: githubToken,
  })
    .then(({ fetchFromRepoTool, contextResource, indexer }) => {
      // Register the fetch tool
      const registeredTool = server.tool(
        fetchFromRepoTool.name,
        fetchFromRepoTool.description,
        fetchFromRepoTool.inputSchema.shape,
        fetchFromRepoTool.handler,
      );

      tools[fetchFromRepoTool.name] = registeredTool;

      // Register the context resource
      server.resource(contextResource.name, contextResource.uri, async () =>
        contextResource.handler(),
      );

      logger.info(
        "Remote repository tools registered successfully. Indexed %d files.",
        indexer.getIndex().size,
      );
    })
    .catch((error) => {
      logger.error(
        "Failed to set up remote repository integration: %s",
        error.message,
      );
    });

  return tools;
}
