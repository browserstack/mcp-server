import {
  percyTokenPost,
  getOrCreateProjectToken,
} from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import {
  writeFile,
  readdir,
  readFile,
  stat,
  unlink,
  mkdtemp,
} from "fs/promises";
import { join, basename, extname } from "path";
import { tmpdir } from "os";
import { createHash } from "crypto";

const execFileAsync = promisify(execFile);

async function getGitBranch(): Promise<string> {
  try {
    return (
      (
        await execFileAsync("git", ["branch", "--show-current"])
      ).stdout.trim() || "main"
    );
  } catch {
    return "main";
  }
}

async function getGitSha(): Promise<string> {
  try {
    return (await execFileAsync("git", ["rev-parse", "HEAD"])).stdout.trim();
  } catch {
    return createHash("sha1").update(Date.now().toString()).digest("hex");
  }
}

async function isPercyCliInstalled(): Promise<boolean> {
  try {
    await execFileAsync("npx", ["@percy/cli", "--version"]);
    return true;
  } catch {
    return false;
  }
}

// ── Types ───────────────────────────────────────────────────────────────────

interface CreateBuildArgs {
  project_name: string;
  // Mode: provide ONE
  urls?: string;
  screenshots_dir?: string;
  screenshot_files?: string;
  test_command?: string;
  // Options
  branch?: string;
  widths?: string;
  type?: string;
  snapshot_names?: string;
  test_case?: string;
}

// ── Main handler ────────────────────────────────────────────────────────────

export async function percyCreateBuildV2(
  args: CreateBuildArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const branch = args.branch || (await getGitBranch());
  const commitSha = await getGitSha();
  const widths = args.widths
    ? args.widths.split(",").map((w) => w.trim())
    : ["375", "1280"];

  // Get project token
  let token: string;
  try {
    token = await getOrCreateProjectToken(args.project_name, config, args.type);
  } catch (e: any) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to access project "${args.project_name}": ${e.message}`,
        },
      ],
      isError: true,
    };
  }

  // Parse custom snapshot names and test cases
  const customNames = args.snapshot_names
    ? args.snapshot_names.split(",").map((n) => n.trim())
    : [];
  // test_case can be single (applies to all) or comma-separated (maps 1:1)
  const testCases = args.test_case
    ? args.test_case.split(",").map((t) => t.trim())
    : [];

  // Detect mode
  if (args.urls) {
    return handleUrlSnapshot(
      args.project_name,
      token,
      args.urls,
      widths,
      branch,
      customNames,
      testCases,
    );
  } else if (args.test_command) {
    return handleTestCommand(
      args.project_name,
      token,
      args.test_command,
      branch,
    );
  } else if (args.screenshots_dir || args.screenshot_files) {
    return handleScreenshotUpload(
      token,
      args,
      branch,
      commitSha,
      customNames,
      testCases,
    );
  } else {
    let output = `## Percy Build — ${args.project_name}\n\n`;
    output += `**Token:** ready (${token.slice(0, 8)}...)\n`;
    output += `**Branch:** ${branch}\n\n`;
    output += `Provide one of:\n`;
    output += `- \`urls\` — URLs to snapshot\n`;
    output += `- \`test_command\` — test command to wrap\n`;
    output += `- \`screenshots_dir\` — folder with PNG/JPG files\n`;
    output += `- \`screenshot_files\` — comma-separated file paths\n`;
    return { content: [{ type: "text", text: output }] };
  }
}

// ── URL Snapshot ────────────────────────────────────────────────────────────

async function handleUrlSnapshot(
  projectName: string,
  token: string,
  urls: string,
  widths: string[],
  branch: string,
  customNames: string[],
  testCases: string[],
): Promise<CallToolResult> {
  const urlList = urls
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);

  const cliInstalled = await isPercyCliInstalled();

  if (!cliInstalled) {
    let output = `## Percy CLI Not Installed\n\n`;
    output += `Install it first:\n\`\`\`bash\nnpm install -g @percy/cli\n\`\`\`\n\n`;
    output += `Then re-run this command.\n`;
    return { content: [{ type: "text", text: output }] };
  }

  // If test cases provided, use percy exec + local API approach
  // (Percy local server at :5338 supports testCase param)
  if (testCases.length > 0) {
    return handleUrlWithTestCases(
      projectName,
      token,
      urlList,
      widths,
      branch,
      customNames,
      testCases,
    );
  }

  // Standard approach: build snapshots.yml and run Percy CLI
  let yamlContent = "";
  urlList.forEach((url, i) => {
    const name =
      customNames[i] ||
      (urlList.length === 1
        ? "Homepage"
        : url
            .replace(/^https?:\/\/[^/]+/, "")
            .replace(/^\//, "")
            .replace(/[/:?&=]/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "") || `Page ${i + 1}`);

    yamlContent += `- name: "${name}"\n`;
    yamlContent += `  url: ${url}\n`;
    yamlContent += `  waitForTimeout: 3000\n`;
    if (widths.length > 0) {
      yamlContent += `  additionalSnapshots:\n`;
      widths.forEach((w) => {
        yamlContent += `    - width: ${w}\n`;
      });
    }
  });

  // Write config to temp file
  const tmpDir = await mkdtemp(join(tmpdir(), "percy-mcp-"));
  const configPath = join(tmpDir, "snapshots.yml");
  await writeFile(configPath, yamlContent);

  // Launch Percy CLI — EXECUTE AUTOMATICALLY
  const child = spawn("npx", ["@percy/cli", "snapshot", configPath], {
    env: { ...process.env, PERCY_TOKEN: token },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  let buildUrl = "";
  let stdoutData = "";
  let stderrData = "";

  child.stdout?.on("data", (d: Buffer) => {
    const text = d.toString();
    stdoutData += text;
    const match = text.match(/https:\/\/percy\.io\/[^\s]+\/builds\/\d+/);
    if (match) buildUrl = match[0];
  });

  child.stderr?.on("data", (d: Buffer) => {
    stderrData += d.toString();
  });

  // Wait for build URL or timeout
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 15000);
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

  // Cleanup temp file later
  setTimeout(async () => {
    try {
      await unlink(configPath);
    } catch {
      /* ignore */
    }
  }, 120000);

  // Build response
  let output = `## Percy Build — ${projectName}\n\n`;
  output += `**Branch:** ${branch}\n`;
  output += `**URLs:** ${urlList.length}\n`;
  output += `**Widths:** ${widths.join(", ")}px\n`;
  if (testCases.length > 0) {
    output += `**Test cases:** ${testCases.join(", ")}\n`;
    output += `> Note: test cases are set via Percy API (screenshot upload mode), not CLI snapshots.\n`;
  }
  output += "\n";

  // Show snapshot names
  output += `**Snapshots:**\n`;
  urlList.forEach((url, i) => {
    const name =
      customNames[i] || (urlList.length === 1 ? "Homepage" : `Page ${i + 1}`);
    output += `- ${name} → ${url}\n`;
  });
  output += "\n";

  if (buildUrl) {
    output += `**Build started!** Percy is rendering in the background.\n\n`;
    output += `**Build URL:** ${buildUrl}\n\n`;
    output += `${urlList.length} URL(s) × ${widths.length} width(s) = ${urlList.length * widths.length} snapshot(s)\n`;
    output += `Results ready in 1-3 minutes.\n`;
  } else {
    const allOutput = (stdoutData + stderrData).trim();
    if (allOutput.includes("ECONNREFUSED") || allOutput.includes("not found")) {
      output += `**Error:** URL not reachable. Make sure your app is running.\n\n`;
      urlList.forEach((u) => {
        output += `- ${u}\n`;
      });
    } else if (allOutput) {
      output += `**Percy output:**\n\`\`\`\n${allOutput.slice(0, 500)}\n\`\`\`\n`;
    } else {
      output += `Percy launched in background. Check your Percy dashboard for results.\n`;
    }
  }

  return { content: [{ type: "text", text: output }] };
}

// ── URL Snapshot with Test Cases (via percy exec + local API) ───────────────

async function handleUrlWithTestCases(
  projectName: string,
  token: string,
  urlList: string[],
  widths: string[],
  branch: string,
  customNames: string[],
  testCases: string[],
): Promise<CallToolResult> {
  // Start percy exec with a dummy command (sleep) to get the local server running
  // Then POST to localhost:5338/percy/snapshot for each URL with testCase
  const child = spawn("npx", ["@percy/cli", "exec", "--", "sleep", "120"], {
    env: { ...process.env, PERCY_TOKEN: token },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  let buildUrl = "";

  child.stdout?.on("data", (d: Buffer) => {
    const text = d.toString();
    const match = text.match(/https:\/\/percy\.io\/[^\s]+\/builds\/\d+/);
    if (match) buildUrl = match[0];
  });
  child.stderr?.on("data", () => {
    // capture stderr but don't store
  });

  // Wait for Percy server to start (looks for "Percy has started" or port 5338)
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 12000);
    const check = setInterval(async () => {
      try {
        const res = await fetch("http://localhost:5338/percy/healthcheck");
        if (res.ok) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve();
        }
      } catch {
        // Not ready yet
      }
    }, 500);
    child.on("close", () => {
      clearTimeout(timeout);
      clearInterval(check);
      resolve();
    });
  });

  let output = `## Percy Build — ${projectName}\n\n`;
  output += `**Branch:** ${branch}\n`;
  output += `**URLs:** ${urlList.length}\n`;
  output += `**Widths:** ${widths.join(", ")}px\n\n`;

  // Send snapshots to Percy local server
  let snapshotCount = 0;
  for (let i = 0; i < urlList.length; i++) {
    const url = urlList[i];
    const name =
      customNames[i] ||
      url
        .replace(/^https?:\/\/[^/]+/, "")
        .replace(/^\//, "")
        .replace(/[/:?&=]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "") ||
      `Page ${i + 1}`;
    const tc = testCases.length === 1 ? testCases[0] : testCases[i];

    try {
      const snapshotBody: Record<string, unknown> = {
        url,
        name,
        widths: widths.map(Number),
        waitForTimeout: 3000,
      };
      if (tc) snapshotBody.testCase = tc;

      const res = await fetch("http://localhost:5338/percy/snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshotBody),
      });

      if (res.ok) {
        snapshotCount++;
        output += `- ✓ **${name}**`;
        if (tc) output += ` (test: ${tc})`;
        output += ` → ${url}\n`;
      } else {
        const errText = await res.text().catch(() => "");
        output += `- ✗ **${name}** — ${res.status}: ${errText.slice(0, 100)}\n`;
      }
    } catch (e: any) {
      output += `- ✗ **${name}** — ${e.message}\n`;
    }
  }

  output += "\n";

  // Stop Percy (send stop signal)
  try {
    await fetch("http://localhost:5338/percy/stop", { method: "POST" });
  } catch {
    // Percy may have already stopped
  }

  // Wait briefly for build URL
  if (!buildUrl) {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 10000);
      const check = setInterval(() => {
        if (buildUrl) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve();
        }
      }, 500);
      child.on("close", () => {
        clearTimeout(timeout);
        clearInterval(check);
        resolve();
      });
    });
  }

  child.unref();

  if (buildUrl) {
    output += `**Build URL:** ${buildUrl}\n\n`;
    output += `${snapshotCount} snapshot(s) captured with test cases. Results ready in 1-3 minutes.\n`;
  } else {
    output += `${snapshotCount} snapshot(s) sent to Percy. Check dashboard for results.\n`;
  }

  return { content: [{ type: "text", text: output }] };
}

// ── Test Command ────────────────────────────────────────────────────────────

async function handleTestCommand(
  projectName: string,
  token: string,
  testCommand: string,
  branch: string,
): Promise<CallToolResult> {
  const cliInstalled = await isPercyCliInstalled();

  if (!cliInstalled) {
    let output = `## Percy CLI Not Installed\n\n`;
    output += `Install it first:\n\`\`\`bash\nnpm install -g @percy/cli\n\`\`\`\n\n`;
    output += `Then re-run this command.\n`;
    return { content: [{ type: "text", text: output }] };
  }

  const cmdParts = testCommand.split(" ").filter(Boolean);

  // EXECUTE AUTOMATICALLY
  const child = spawn("npx", ["@percy/cli", "exec", "--", ...cmdParts], {
    env: { ...process.env, PERCY_TOKEN: token },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  let buildUrl = "";
  let stdoutData = "";

  child.stdout?.on("data", (d: Buffer) => {
    const text = d.toString();
    stdoutData += text;
    const match = text.match(/https:\/\/percy\.io\/[^\s]+\/builds\/\d+/);
    if (match) buildUrl = match[0];
  });
  child.stderr?.on("data", (d: Buffer) => {
    stdoutData += d.toString();
  });

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 15000);
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

  let output = `## Percy Build — Tests\n\n`;
  output += `**Project:** ${projectName}\n`;
  output += `**Command:** \`${testCommand}\`\n`;
  output += `**Branch:** ${branch}\n\n`;

  if (buildUrl) {
    output += `**Build URL:** ${buildUrl}\n\nTests running in background.\n`;
  } else if (stdoutData.trim()) {
    output += `**Output:**\n\`\`\`\n${stdoutData.trim().slice(0, 500)}\n\`\`\`\n`;
  } else {
    output += `Tests launched in background. Check Percy dashboard.\n`;
  }

  return { content: [{ type: "text", text: output }] };
}

// ── Screenshot Upload ───────────────────────────────────────────────────────

async function handleScreenshotUpload(
  token: string,
  args: CreateBuildArgs,
  branch: string,
  commitSha: string,
  customNames: string[],
  testCases: string[],
): Promise<CallToolResult> {
  let files: string[] = [];

  if (args.screenshot_files) {
    files = args.screenshot_files
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
  }
  if (args.screenshots_dir) {
    try {
      const dirStat = await stat(args.screenshots_dir);
      if (dirStat.isDirectory()) {
        const entries = await readdir(args.screenshots_dir);
        files.push(
          ...entries
            .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
            .map((f) => join(args.screenshots_dir!, f)),
        );
      }
    } catch (e: any) {
      return {
        content: [
          {
            type: "text",
            text: `Directory not accessible: ${e.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  if (files.length === 0) {
    return {
      content: [{ type: "text", text: "No image files found." }],
      isError: true,
    };
  }

  // Create build
  const buildResponse = await percyTokenPost("/builds", token, {
    data: {
      type: "builds",
      attributes: { branch, "commit-sha": commitSha },
      relationships: { resources: { data: [] } },
    },
  });
  const buildId = buildResponse?.data?.id;
  const buildUrl = buildResponse?.data?.attributes?.["web-url"] || "";

  if (!buildId) {
    return {
      content: [{ type: "text", text: "Failed to create build." }],
      isError: true,
    };
  }

  let output = `## Percy Build — Screenshot Upload\n\n`;
  output += `**Build:** #${buildId}\n**Files:** ${files.length}\n\n`;

  let uploaded = 0;
  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    // Use custom name, or clean filename
    const name =
      customNames[i] ||
      basename(filePath, extname(filePath)).replace(/[-_]/g, " ");

    try {
      const content = await readFile(filePath);
      const sha = createHash("sha256").update(content).digest("hex");
      const base64 = content.toString("base64");

      let width = 1280;
      let height = 800;
      if (content[0] === 0x89 && content[1] === 0x50) {
        width = content.readUInt32BE(16);
        height = content.readUInt32BE(20);
      }

      // Create snapshot with optional test case
      // If 1 test case provided → applies to all snapshots
      // If multiple → maps 1:1 with files
      const snapAttrs: Record<string, unknown> = { name };
      const tc = testCases.length === 1 ? testCases[0] : testCases[i];
      if (tc) snapAttrs["test-case"] = tc;

      const snapRes = await percyTokenPost(
        `/builds/${buildId}/snapshots`,
        token,
        { data: { type: "snapshots", attributes: snapAttrs } },
      );
      const snapId = snapRes?.data?.id;
      if (!snapId) {
        output += `- ✗ ${name}: snapshot failed\n`;
        continue;
      }

      // Create comparison
      const compRes = await percyTokenPost(
        `/snapshots/${snapId}/comparisons`,
        token,
        {
          data: {
            attributes: {
              "external-debug-url": null,
              "dom-info-sha": null,
            },
            relationships: {
              tag: {
                data: {
                  attributes: {
                    name: "Screenshot",
                    width,
                    height,
                    "os-name": "Upload",
                    "browser-name": "Screenshot",
                  },
                },
              },
              tiles: {
                data: [
                  {
                    attributes: {
                      sha,
                      "status-bar-height": 0,
                      "nav-bar-height": 0,
                    },
                  },
                ],
              },
            },
          },
        },
      );
      const compId = compRes?.data?.id;
      if (!compId) {
        output += `- ✗ ${name}: comparison failed\n`;
        continue;
      }

      // Upload tile
      await percyTokenPost(`/comparisons/${compId}/tiles`, token, {
        data: { attributes: { "base64-content": base64 } },
      });

      // Finalize comparison
      await percyTokenPost(`/comparisons/${compId}/finalize`, token, {});

      uploaded++;
      output += `- ✓ **${name}** (${width}×${height})\n`;
    } catch (e: any) {
      output += `- ✗ ${name}: ${e.message}\n`;
    }
  }

  // Finalize build
  try {
    await percyTokenPost(`/builds/${buildId}/finalize`, token, {});
    output += `\n**Build finalized.** ${uploaded}/${files.length} uploaded.\n`;
  } catch (e: any) {
    output += `\n**Finalize failed:** ${e.message}\n`;
  }
  if (buildUrl) output += `**View:** ${buildUrl}\n`;

  return { content: [{ type: "text", text: output }] };
}
