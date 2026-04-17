/**
 * percy_snapshot_urls — Actually runs Percy CLI to snapshot URLs locally.
 *
 * Fire-and-forget: launches percy CLI in background, returns immediately
 * with build URL. User checks Percy dashboard for results.
 *
 * Requires @percy/cli installed locally (npx or global).
 */

import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { writeFile, unlink, mkdtemp } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const execFileAsync = promisify(execFile);

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getProjectToken(
  projectName: string,
  config: BrowserStackConfig,
  type?: string,
): Promise<string> {
  const authString = `${config["browserstack-username"]}:${config["browserstack-access-key"]}`;
  const auth = Buffer.from(authString).toString("base64");
  const params = new URLSearchParams({ name: projectName });
  if (type) params.append("type", type);
  const url = `https://api.browserstack.com/api/app_percy/get_project_token?${params.toString()}`;
  const response = await fetch(url, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!response.ok) throw new Error(`Failed to get token for "${projectName}"`);
  const data = await response.json();
  if (!data?.token || !data?.success)
    throw new Error(`No token for "${projectName}"`);
  return data.token;
}

async function checkPercyCli(): Promise<string | null> {
  // Check if @percy/cli is available
  try {
    const { stdout } = await execFileAsync("npx", ["@percy/cli", "--version"]);
    return stdout.trim();
  } catch {
    // Try global
    try {
      const { stdout } = await execFileAsync("percy", ["--version"]);
      return stdout.trim();
    } catch {
      return null;
    }
  }
}

// ── Main handler ────────────────────────────────────────────────────────────

interface SnapshotUrlsArgs {
  project_name: string;
  urls: string;
  widths?: string;
  type?: string;
}

export async function percySnapshotUrls(
  args: SnapshotUrlsArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const urls = args.urls
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  const widths = args.widths
    ? args.widths.split(",").map((w) => w.trim())
    : ["375", "1280"];

  if (urls.length === 0) {
    return {
      content: [{ type: "text", text: "No URLs provided." }],
      isError: true,
    };
  }

  let output = `## Percy Snapshot — Local Rendering\n\n`;

  // Step 1: Check Percy CLI
  const cliVersion = await checkPercyCli();
  if (!cliVersion) {
    output += `**Percy CLI not found.** Install it first:\n\n`;
    output += `\`\`\`bash\nnpm install -g @percy/cli\n\`\`\`\n\n`;
    output += `Or install locally: \`npm install --save-dev @percy/cli\`\n`;
    return { content: [{ type: "text", text: output }] };
  }
  output += `**Percy CLI:** ${cliVersion}\n`;

  // Step 2: Get project token
  let token: string;
  try {
    token = await getProjectToken(args.project_name, config, args.type);
  } catch (e: any) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to get project token: ${e.message}`,
        },
      ],
      isError: true,
    };
  }
  output += `**Project:** ${args.project_name}\n`;
  output += `**URLs:** ${urls.length}\n`;
  output += `**Widths:** ${widths.join(", ")}px\n\n`;

  // Step 3: Create snapshots.yml config
  let yamlContent = "";
  urls.forEach((url, i) => {
    const name =
      urls.length === 1
        ? "Homepage"
        : url
            .replace(/^https?:\/\//, "")
            .replace(/[/:]/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "") || `Page ${i + 1}`;
    yamlContent += `- name: "${name}"\n`;
    yamlContent += `  url: ${url}\n`;
    yamlContent += `  waitForTimeout: 3000\n`;
    yamlContent += `  additionalSnapshots:\n`;
    widths.forEach((w) => {
      yamlContent += `    - width: ${w}\n`;
    });
  });

  // Write temp config file
  const tmpDir = await mkdtemp(join(tmpdir(), "percy-mcp-"));
  const configPath = join(tmpDir, "snapshots.yml");
  await writeFile(configPath, yamlContent, "utf-8");

  // Step 4: Launch Percy CLI in background
  output += `### Launching Percy snapshot...\n\n`;

  const env = {
    ...process.env,
    PERCY_TOKEN: token,
  };

  // Spawn percy CLI in background (fire and forget)
  const child = spawn("npx", ["@percy/cli", "snapshot", configPath], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  // Collect initial output for a few seconds
  let stdoutData = "";
  let stderrData = "";
  let buildUrl = "";

  child.stdout?.on("data", (data: Buffer) => {
    const text = data.toString();
    stdoutData += text;
    // Try to extract build URL
    const match = text.match(/https:\/\/percy\.io\/[^\s]+\/builds\/\d+/);
    if (match) buildUrl = match[0];
  });

  child.stderr?.on("data", (data: Buffer) => {
    stderrData += data.toString();
  });

  // Wait a few seconds for initial output (build creation)
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => resolve(), 8000);

    child.on("close", () => {
      clearTimeout(timeout);
      resolve();
    });

    // Also resolve if we find the build URL early
    const checkInterval = setInterval(() => {
      if (buildUrl) {
        clearTimeout(timeout);
        clearInterval(checkInterval);
        resolve();
      }
    }, 500);
  });

  // Unref so the process doesn't keep MCP server alive
  child.unref();

  // Clean up temp file after a delay
  setTimeout(async () => {
    try {
      await unlink(configPath);
    } catch {
      // ignore
    }
  }, 120000); // 2 minutes

  // Step 5: Report results
  if (buildUrl) {
    output += `**Build started!** Percy is rendering your pages in the background.\n\n`;
    output += `**Build URL:** ${buildUrl}\n\n`;
    output += `Percy is capturing ${urls.length} URL(s) at ${widths.length} width(s) = ${urls.length * widths.length} snapshot(s).\n\n`;
    output += `Check the build URL above for results (usually ready in 1-3 minutes).\n`;
  } else if (stdoutData || stderrData) {
    // No build URL found yet — show what we have
    const allOutput = (stdoutData + stderrData).trim();

    // Check for common errors
    if (allOutput.includes("not found") || allOutput.includes("ECONNREFUSED")) {
      output += `**Error:** The URL may not be reachable.\n\n`;
      output += `Make sure your app is running at the specified URL(s):\n`;
      urls.forEach((u) => {
        output += `- ${u}\n`;
      });
      output += `\n`;
    }

    output += `**Percy CLI output:**\n\`\`\`\n${allOutput.slice(0, 500)}\n\`\`\`\n\n`;
    output += `Percy is running in the background. If a build was created, check your Percy dashboard.\n`;
  } else {
    output += `**Percy CLI launched in background.** No output yet.\n\n`;
    output += `The build should appear in your Percy dashboard shortly.\n`;
    output += `Check: https://percy.io\n`;
  }

  return { content: [{ type: "text", text: output }] };
}
