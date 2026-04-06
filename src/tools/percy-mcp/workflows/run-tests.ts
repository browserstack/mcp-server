/**
 * percy_run_tests — Execute a test command with Percy visual testing.
 *
 * Wraps any test command with `percy exec` to capture snapshots during tests.
 * Fire-and-forget: launches in background, returns immediately.
 *
 * Requires @percy/cli installed locally.
 */

import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { execFile, spawn } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

async function getProjectToken(
  projectName: string,
  config: BrowserStackConfig,
): Promise<string> {
  const authString = `${config["browserstack-username"]}:${config["browserstack-access-key"]}`;
  const auth = Buffer.from(authString).toString("base64");
  const url = `https://api.browserstack.com/api/app_percy/get_project_token?name=${encodeURIComponent(projectName)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!response.ok) throw new Error(`Failed to get token for "${projectName}"`);
  const data = await response.json();
  if (!data?.token || !data?.success)
    throw new Error(`No token for "${projectName}"`);
  return data.token;
}

interface RunTestsArgs {
  project_name: string;
  test_command: string;
  type?: string;
}

export async function percyRunTests(
  args: RunTestsArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const { project_name, test_command } = args;

  let output = `## Percy Test Run — Local Execution\n\n`;

  // Check Percy CLI
  try {
    await execFileAsync("npx", ["@percy/cli", "--version"]);
  } catch {
    output += `**Percy CLI not found.** Install it:\n\n`;
    output += `\`\`\`bash\nnpm install -g @percy/cli\n\`\`\`\n`;
    return { content: [{ type: "text", text: output }] };
  }

  // Get token
  let token: string;
  try {
    token = await getProjectToken(project_name, config);
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

  output += `**Project:** ${project_name}\n`;
  output += `**Command:** \`${test_command}\`\n\n`;

  // Parse the test command into args
  const cmdParts = test_command.split(" ").filter(Boolean);

  // Spawn: npx @percy/cli exec -- <test_command>
  const child = spawn("npx", ["@percy/cli", "exec", "--", ...cmdParts], {
    env: { ...process.env, PERCY_TOKEN: token },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    shell: false,
  });

  let stdoutData = "";
  let buildUrl = "";

  child.stdout?.on("data", (data: Buffer) => {
    const text = data.toString();
    stdoutData += text;
    const match = text.match(/https:\/\/percy\.io\/[^\s]+\/builds\/\d+/);
    if (match) buildUrl = match[0];
  });

  child.stderr?.on("data", (data: Buffer) => {
    stdoutData += data.toString();
  });

  // Wait briefly for build URL
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => resolve(), 10000);
    child.on("close", () => {
      clearTimeout(timeout);
      resolve();
    });
    const check = setInterval(() => {
      if (buildUrl) {
        clearTimeout(timeout);
        clearInterval(check);
        resolve();
      }
    }, 500);
  });

  child.unref();

  if (buildUrl) {
    output += `**Build started!** Tests are running with Percy in the background.\n\n`;
    output += `**Build URL:** ${buildUrl}\n\n`;
    output += `Your tests are executing. Each \`percySnapshot()\` call in your tests captures a visual snapshot.\n`;
    output += `Results will appear at the build URL when tests complete.\n`;
  } else {
    const trimmed = stdoutData.trim().slice(0, 500);
    if (trimmed) {
      output += `**Percy output:**\n\`\`\`\n${trimmed}\n\`\`\`\n\n`;
    }
    output += `Tests are running in the background with Percy. Check your Percy dashboard for the build.\n`;
  }

  return { content: [{ type: "text", text: output }] };
}
