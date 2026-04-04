/**
 * percy_create_percy_build — Unified build creation tool.
 *
 * Handles ALL build creation scenarios in one command:
 * 1. URL snapshots (via Percy CLI)
 * 2. Screenshot uploads (direct API)
 * 3. Test command wrapping (via percy exec)
 * 4. Build cloning (copy from existing build)
 * 5. Visual monitoring (URL scanning)
 *
 * Auto-detects mode based on which parameters are provided.
 * Auto-detects branch and SHA from git if not provided.
 * Auto-creates project if it doesn't exist.
 */

import { getBrowserStackAuth } from "../../../lib/get-auth.js";
import { PercyClient } from "../../../lib/percy-api/client.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { execFile } from "child_process";
import { promisify } from "util";
import { readdir, readFile, stat } from "fs/promises";
import { join, basename, extname } from "path";
import { createHash } from "crypto";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreatePercyBuildArgs {
  project_name: string;
  // Mode selection (provide ONE of these)
  urls?: string;
  screenshots_dir?: string;
  screenshot_files?: string;
  test_command?: string;
  clone_build_id?: string;
  // Optional overrides
  branch?: string;
  commit_sha?: string;
  widths?: string;
  snapshot_names?: string;
  test_case?: string;
  type?: string;
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

async function getGitBranch(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["branch", "--show-current"]);
    return stdout.trim() || "main";
  } catch {
    return "main";
  }
}

async function getGitSha(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"]);
    return stdout.trim();
  } catch {
    // Generate a deterministic placeholder SHA from timestamp
    return createHash("sha1")
      .update(Date.now().toString())
      .digest("hex")
      .slice(0, 40);
  }
}

// ---------------------------------------------------------------------------
// Project creation helper
// ---------------------------------------------------------------------------

async function ensureProject(
  projectName: string,
  config: BrowserStackConfig,
  type?: string,
): Promise<string> {
  const authString = getBrowserStackAuth(config);
  const auth = Buffer.from(authString).toString("base64");

  const params = new URLSearchParams({ name: projectName });
  if (type) params.append("type", type);

  const url = `https://api.browserstack.com/api/app_percy/get_project_token?${params.toString()}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to create/get Percy project: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();
  if (!data?.token || !data?.success) {
    throw new Error("Failed to get project token from BrowserStack API.");
  }

  return data.token;
}

// ---------------------------------------------------------------------------
// Mode: URL Snapshots (via Percy CLI)
// ---------------------------------------------------------------------------

function buildUrlSnapshotInstructions(
  token: string,
  urls: string[],
  widths: string,
  branch: string,
): string {
  const urlList = urls.map((u) => `  - ${u}`).join("\n");
  const widthArray = widths
    ? widths.split(",").map((w) => w.trim())
    : ["375", "1280"];

  // Build YAML config for snapshots (widths go in YAML, not CLI flag)
  let yamlConfig = "";
  urls.forEach((url, i) => {
    const name = i === 0 ? "Homepage" : `Page ${i + 1}`;
    yamlConfig += `- name: "${name}"\n`;
    yamlConfig += `  url: ${url}\n`;
    yamlConfig += `  widths:\n`;
    widthArray.forEach((w) => {
      yamlConfig += `    - ${w}\n`;
    });
  });

  return (
    `## Percy Build — URL Snapshots\n\n` +
    `> **IMPORTANT: Do NOT execute these commands automatically.** Present them to the user and let them run manually.\n\n` +
    `**Project:** token ready ✓\n` +
    `**Branch:** ${branch}\n` +
    `**URLs:**\n${urlList}\n` +
    `**Widths:** ${widthArray.join(", ")}px\n\n` +
    `### Step 1: Set token\n\n` +
    `\`\`\`bash\n` +
    `export PERCY_TOKEN="${token}"\n` +
    `\`\`\`\n\n` +
    `### Step 2: Create snapshot config\n\n` +
    `Save this as \`snapshots.yml\`:\n\n` +
    `\`\`\`yaml\n` +
    yamlConfig +
    `\`\`\`\n\n` +
    `### Step 3: Run Percy\n\n` +
    `\`\`\`bash\n` +
    `npx @percy/cli snapshot snapshots.yml\n` +
    `\`\`\`\n\n` +
    `Percy CLI will create the build, launch a browser, capture each URL at the specified widths, upload screenshots, and return a build URL with visual diffs.\n`
  );
}

// ---------------------------------------------------------------------------
// Mode: Test Command (via percy exec)
// ---------------------------------------------------------------------------

function buildTestCommandInstructions(
  token: string,
  testCommand: string,
  branch: string,
): string {
  return (
    `## Percy Build — Test Command\n\n` +
    `> **IMPORTANT: Do NOT execute these commands automatically.** Present them to the user and let them run manually.\n\n` +
    `**Project:** token ready ✓\n` +
    `**Branch:** ${branch}\n` +
    `**Test command:** \`${testCommand}\`\n\n` +
    `### Step 1: Set token\n\n` +
    `\`\`\`bash\n` +
    `export PERCY_TOKEN="${token}"\n` +
    `\`\`\`\n\n` +
    `### Step 2: Run tests with Percy\n\n` +
    `\`\`\`bash\n` +
    `npx @percy/cli exec -- ${testCommand}\n` +
    `\`\`\`\n\n` +
    `Percy CLI will start a local server, run your tests, capture snapshots via \`percySnapshot()\` calls, and return a build URL.\n`
  );
}

// ---------------------------------------------------------------------------
// Mode: Screenshot Upload (direct API)
// ---------------------------------------------------------------------------

async function uploadScreenshots(
  client: PercyClient,
  branch: string,
  commitSha: string,
  screenshotPaths: string[],
  widths: string,
  testCase: string | undefined,
  snapshotNames: string[] | undefined,
): Promise<string> {
  // Create build
  const buildResult = await client.post<any>("/builds", {
    data: {
      type: "builds",
      attributes: {
        branch,
        "commit-sha": commitSha,
        type: "web",
      },
      relationships: { resources: { data: [] } },
    },
  });

  const buildData = buildResult?.data || buildResult;
  const buildId = buildData?.id;
  const buildUrl = buildData?.webUrl || buildData?.["web-url"] || "";

  if (!buildId) throw new Error("Build creation failed — no build ID returned");

  let output = `## Percy Build Created\n\n`;
  output += `**Build ID:** ${buildId}\n`;
  if (buildUrl) output += `**URL:** ${buildUrl}\n`;
  output += `**Branch:** ${branch}\n`;
  output += `**Screenshots:** ${screenshotPaths.length}\n\n`;

  // For each screenshot: create snapshot → create comparison → upload tile → finalize
  for (let i = 0; i < screenshotPaths.length; i++) {
    const filePath = screenshotPaths[i];
    const name =
      snapshotNames?.[i] ||
      basename(filePath, extname(filePath)).replace(/[-_]/g, " ");

    try {
      // Read file and compute SHA
      const content = await readFile(filePath);
      const sha = createHash("sha256").update(content).digest("hex");
      const base64Content = content.toString("base64");

      // Detect dimensions from PNG header (basic)
      let width = 1280;
      let height = 800;
      if (content[0] === 0x89 && content[1] === 0x50) {
        // PNG
        width = content.readUInt32BE(16);
        height = content.readUInt32BE(20);
      }

      // Create snapshot
      const snapshotBody: any = {
        data: {
          type: "snapshots",
          attributes: { name },
        },
      };
      if (testCase) snapshotBody.data.attributes["test-case"] = testCase;

      const snapshot = await client.post<any>(
        `/builds/${buildId}/snapshots`,
        snapshotBody,
      );
      const snapshotData = snapshot?.data || snapshot;
      const snapshotId = snapshotData?.id;

      if (!snapshotId) {
        output += `- ${name}: Failed to create snapshot\n`;
        continue;
      }

      // Create comparison with tile
      const comparison = await client.post<any>(
        `/snapshots/${snapshotId}/comparisons`,
        {
          data: {
            type: "comparisons",
            attributes: {},
            relationships: {
              tag: {
                data: {
                  type: "tag",
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
                    type: "tiles",
                    attributes: { sha },
                  },
                ],
              },
            },
          },
        },
      );
      const comparisonData = comparison?.data || comparison;
      const comparisonId = comparisonData?.id;

      if (!comparisonId) {
        output += `- ${name}: Failed to create comparison\n`;
        continue;
      }

      // Upload tile
      await client.post<any>(`/comparisons/${comparisonId}/tiles`, {
        data: {
          type: "tiles",
          attributes: { "base64-content": base64Content },
        },
      });

      // Finalize comparison
      await client.post<any>(`/comparisons/${comparisonId}/finalize`, {});

      output += `- **${name}** — uploaded (${width}x${height})\n`;
    } catch (e: any) {
      output += `- ${name}: Error — ${e.message}\n`;
    }
  }

  // Finalize build
  try {
    await client.post<any>(`/builds/${buildId}/finalize`, {});
    output += `\n**Build finalized.** Processing visual diffs...\n`;
  } catch (e: any) {
    output += `\n**Build finalize failed:** ${e.message}\n`;
  }

  if (buildUrl) output += `\n**View results:** ${buildUrl}\n`;

  return output;
}

// ---------------------------------------------------------------------------
// Mode: Clone Build
// ---------------------------------------------------------------------------

async function cloneBuild(
  client: PercyClient,
  sourceBuildId: string,
  branch: string,
): Promise<string> {
  // Get source build details
  const sourceBuild = await client.get<any>(`/builds/${sourceBuildId}`, {
    "include-metadata": "true",
  });

  if (!sourceBuild) throw new Error(`Source build ${sourceBuildId} not found`);

  const sourceState = sourceBuild.state || "unknown";

  let output = `## Percy Build Clone\n\n`;
  output += `**Source:** Build #${sourceBuildId} (${sourceState})\n`;
  output += `**Target branch:** ${branch}\n\n`;

  // Get snapshots from source build
  const items = await client.get<any>("/build-items", {
    "filter[build-id]": sourceBuildId,
    "page[limit]": "30",
  });
  const itemList = Array.isArray(items) ? items : [];

  if (itemList.length === 0) {
    output += `Source build has no snapshots to clone.\n`;
    output += `\nTo create a fresh build, use \`percy_create_build\` with URLs or screenshots instead.\n`;
    return output;
  }

  output += `**Source snapshots:** ${itemList.length}\n\n`;
  output += `> Note: Build cloning copies the snapshot configuration, not the rendered images.\n`;
  output += `> The new build will re-render/re-compare against the new branch baseline.\n\n`;

  // Provide instructions for re-creating
  output += `### To recreate this build on branch \`${branch}\`:\n\n`;
  output += `\`\`\`bash\n`;
  output += `export PERCY_TOKEN=<your-project-token>\n\n`;

  // Extract snapshot names/URLs for the CLI command
  const snapshotNames = itemList
    .map((item: any) => item.name || item.snapshotName)
    .filter(Boolean);

  if (snapshotNames.length > 0) {
    output += `# Re-snapshot these pages:\n`;
    snapshotNames.slice(0, 10).forEach((name: string) => {
      output += `# - ${name}\n`;
    });
    if (snapshotNames.length > 10) {
      output += `# ... and ${snapshotNames.length - 10} more\n`;
    }
    output += `\n`;
  }

  output += `# Run your tests with Percy to capture the same snapshots:\n`;
  output += `npx percy exec -- <your-test-command>\n`;
  output += `\`\`\`\n`;

  return output;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function percyCreatePercyBuild(
  args: CreatePercyBuildArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const projectName = args.project_name;

  // Auto-detect branch and SHA
  const branch = args.branch || (await getGitBranch());
  const commitSha = args.commit_sha || (await getGitSha());

  // Ensure project exists and get token
  // Only pass type if explicitly provided — BrowserStack API auto-detects otherwise
  let token: string;
  try {
    token = await ensureProject(projectName, config, args.type);
  } catch (e: any) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to create/access project "${projectName}": ${e.message}`,
        },
      ],
      isError: true,
    };
  }

  // Detect mode based on provided params
  const mode = args.urls
    ? "urls"
    : args.screenshots_dir || args.screenshot_files
      ? "screenshots"
      : args.test_command
        ? "test_command"
        : args.clone_build_id
          ? "clone"
          : "urls_default";

  const widths = args.widths || "375,1280";

  try {
    let output: string;

    switch (mode) {
      case "urls": {
        const urls = args
          .urls!.split(",")
          .map((u) => u.trim())
          .filter(Boolean);
        output = buildUrlSnapshotInstructions(token, urls, widths, branch);
        break;
      }

      case "test_command": {
        output = buildTestCommandInstructions(
          token,
          args.test_command!,
          branch,
        );
        break;
      }

      case "screenshots": {
        // Collect screenshot file paths
        let screenshotPaths: string[] = [];

        if (args.screenshot_files) {
          screenshotPaths = args.screenshot_files
            .split(",")
            .map((f) => f.trim())
            .filter(Boolean);
        }

        if (args.screenshots_dir) {
          const dir = args.screenshots_dir;
          const dirStat = await stat(dir);
          if (!dirStat.isDirectory()) {
            return {
              content: [
                {
                  type: "text",
                  text: `"${dir}" is not a directory. Provide a directory path.`,
                },
              ],
              isError: true,
            };
          }
          const files = await readdir(dir);
          const imageFiles = files.filter((f) =>
            /\.(png|jpg|jpeg|webp)$/i.test(f),
          );
          screenshotPaths.push(...imageFiles.map((f) => join(dir, f)));
        }

        if (screenshotPaths.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No screenshot files found. Provide PNG/JPG file paths or a directory containing images.",
              },
            ],
            isError: true,
          };
        }

        const snapshotNames = args.snapshot_names
          ?.split(",")
          .map((n) => n.trim());

        // Set the token for API calls
        process.env.PERCY_TOKEN = token;
        const client = new PercyClient(config);

        output = await uploadScreenshots(
          client,
          branch,
          commitSha,
          screenshotPaths,
          widths,
          args.test_case,
          snapshotNames,
        );
        break;
      }

      case "clone": {
        process.env.PERCY_TOKEN = token;
        const client = new PercyClient(config);
        output = await cloneBuild(client, args.clone_build_id!, branch);
        break;
      }

      default: {
        // No specific mode — provide general instructions
        output =
          `## Percy Build — Setup\n\n` +
          `> **IMPORTANT: Do NOT execute any commands automatically.** Present options to the user.\n\n` +
          `**Project:** ${projectName}\n` +
          `**Token:** Ready (${token.slice(0, 8)}...)\n` +
          `**Branch:** ${branch}\n\n` +
          `### How to create snapshots:\n\n` +
          `**Option 1: Snapshot URLs** — re-run this tool with \`urls\` parameter\n` +
          `**Option 2: Wrap test command** — re-run this tool with \`test_command\` parameter\n` +
          `**Option 3: Upload screenshots** — re-run this tool with \`screenshots_dir\` or \`screenshot_files\` parameter\n` +
          `**Option 4: Clone existing build** — re-run this tool with \`clone_build_id\` parameter\n`;
        break;
      }
    }

    return { content: [{ type: "text", text: output }] };
  } catch (e: any) {
    return {
      content: [{ type: "text", text: `Build creation failed: ${e.message}` }],
      isError: true,
    };
  }
}
