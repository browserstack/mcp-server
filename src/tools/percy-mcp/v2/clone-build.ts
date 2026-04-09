/**
 * percy_clone_build — Clone a build into a different project. Fully automatic.
 *
 * Uses Percy CLI for everything (auto-installs if missing). Same target project,
 * same project type — no companion projects or type mismatches.
 *
 * Two modes (auto-selected):
 *   1. URL Replay (`percy snapshot`): For URL-named snapshots — re-renders with
 *      full DOM/CSS/JS resource discovery. Best quality.
 *   2. Screenshot Upload (`percy upload`): For named snapshots — downloads
 *      rendered screenshots and uploads via CLI. Works with any project type.
 */

import {
  percyGet,
  getOrCreateProjectToken,
  getPercyAuthHeaders,
} from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { writeFile, unlink, mkdtemp } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

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

interface ComparisonInfo {
  width: number;
  height: number;
  tagName: string;
  osName: string;
  osVersion: string;
  browserName: string;
  browserVersion: string;
  orientation: string;
  imageUrl: string | null;
}

interface SnapshotInfo {
  id: string;
  name: string;
  displayName: string;
  widths: number[];
  enableJavascript: boolean;
  testCase: string | null;
  comparisons: ComparisonInfo[];
}

interface CloneBuildArgs {
  source_build_id: string;
  target_project_name: string;
  target_token?: string;
  branch?: string;
}

export async function percyCloneBuildV2(
  args: CloneBuildArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const branch = args.branch || (await getGitBranch());

  let output = `## Percy Build Clone\n\n`;
  output += `**Source:** Build #${args.source_build_id}\n`;
  output += `**Target:** ${args.target_project_name}\n`;
  output += `**Branch:** ${branch}\n\n`;

  // ── Step 1: Read source build ─────────────────────────────────────────

  let sourceBuild: any;
  try {
    sourceBuild = await percyGet(`/builds/${args.source_build_id}`, config);
  } catch (e: any) {
    return {
      content: [
        { type: "text", text: `Failed to read source build: ${e.message}` },
      ],
      isError: true,
    };
  }

  const sourceAttrs = sourceBuild?.data?.attributes || {};
  const buildType = sourceAttrs.type || "web";

  output += `Source: **${sourceAttrs.state}** — ${sourceAttrs["total-snapshots"]} snapshots, type: ${buildType}\n\n`;

  // ── Step 2: Get snapshot details with full comparison/device info ──────

  const headers = getPercyAuthHeaders(config);
  const baseUrl = "https://percy.io/api/v1";

  let allSnapshotIds: string[] = [];
  try {
    const items = await percyGet("/build-items", config, {
      "filter[build-id]": args.source_build_id,
      "page[limit]": "30",
    });
    const itemList = items?.data || [];
    for (const item of itemList) {
      const a = item.attributes || item;
      const ids = a["snapshot-ids"] || a.snapshotIds || [];
      if (ids.length > 0) {
        allSnapshotIds.push(...ids.map(String));
      } else if (a["cover-snapshot-id"] || a.coverSnapshotId) {
        allSnapshotIds.push(
          String(a["cover-snapshot-id"] || a.coverSnapshotId),
        );
      }
    }
    allSnapshotIds = [...new Set(allSnapshotIds)];
  } catch (e: any) {
    return {
      content: [
        { type: "text", text: `Failed to read snapshots: ${e.message}` },
      ],
      isError: true,
    };
  }

  output += `Found **${allSnapshotIds.length}** snapshots.\n\n`;

  if (allSnapshotIds.length === 0) {
    output += `Nothing to clone.\n`;
    return { content: [{ type: "text", text: output }] };
  }

  // Read snapshot metadata with full comparison-tag details
  const snapsToClone = allSnapshotIds.slice(0, 20);
  const snapshots: SnapshotInfo[] = [];

  for (const snapId of snapsToClone) {
    try {
      const snapResponse = await fetch(
        `${baseUrl}/snapshots/${snapId}?include=comparisons.head-screenshot.image,comparisons.comparison-tag`,
        { headers },
      );
      if (!snapResponse.ok) continue;

      const snapJson = await snapResponse.json();
      const sa = snapJson.data?.attributes || {};
      const included = snapJson.included || [];

      const byTypeId = new Map<string, any>();
      for (const item of included) {
        byTypeId.set(`${item.type}:${item.id}`, item);
      }

      const compRefs = snapJson.data?.relationships?.comparisons?.data || [];
      const comparisons: ComparisonInfo[] = [];
      const widthSet = new Set<number>();

      for (const ref of compRefs) {
        const comp = byTypeId.get(`comparisons:${ref.id}`);
        if (!comp) continue;

        const width = comp.attributes?.width || 1280;
        widthSet.add(width);

        let imageUrl: string | null = null;
        let height = 800;

        const hsRef = comp.relationships?.["head-screenshot"]?.data;
        if (hsRef) {
          const ss = byTypeId.get(`screenshots:${hsRef.id}`);
          const imgRef = ss?.relationships?.image?.data;
          if (imgRef) {
            const img = byTypeId.get(`images:${imgRef.id}`);
            if (img) {
              imageUrl = img.attributes?.url || null;
              height = img.attributes?.height || 800;
            }
          }
        }

        // Extract REAL device/browser info from comparison tag
        const tagRef = comp.relationships?.["comparison-tag"]?.data;
        let tagName = "Chrome";
        let osName = "";
        let osVersion = "";
        let browserName = "Chrome";
        let browserVersion = "";
        let orientation = "portrait";

        if (tagRef) {
          const tag = byTypeId.get(`comparison-tags:${tagRef.id}`);
          if (tag?.attributes) {
            const ta = tag.attributes;
            tagName = ta.name || tagName;
            osName = ta["os-name"] || osName;
            osVersion = ta["os-version"] || osVersion;
            browserName = ta["browser-name"] || browserName;
            browserVersion = ta["browser-version"] || browserVersion;
            orientation = ta.orientation || orientation;
          }
        }

        comparisons.push({
          width,
          height,
          tagName,
          osName,
          osVersion,
          browserName,
          browserVersion,
          orientation,
          imageUrl,
        });
      }

      snapshots.push({
        id: snapId,
        name: sa.name || `Snapshot ${snapId}`,
        displayName: sa["display-name"] || sa.name || "",
        widths: [...widthSet].sort(),
        enableJavascript: sa["enable-javascript"] || false,
        testCase: sa["test-case-name"] || null,
        comparisons,
      });
    } catch {
      /* skip failed snapshots */
    }
  }

  output += `Read **${snapshots.length}** snapshot details.\n\n`;

  // ── Step 3: Ensure Percy CLI is available (auto-install if missing) ───

  let hasCli = false;
  try {
    await execFileAsync("npx", ["@percy/cli", "--version"]);
    hasCli = true;
  } catch {
    output += `Installing Percy CLI...\n`;
    try {
      await execFileAsync("npm", ["install", "-g", "@percy/cli"], {
        timeout: 60000,
      });
      hasCli = true;
      output += `Percy CLI installed.\n\n`;
    } catch {
      hasCli = false;
      output += `Percy CLI install failed — using screenshot copy.\n\n`;
    }
  }

  // ── Step 4: Get target project token ──────────────────────────────────

  let targetToken: string;
  if (args.target_token) {
    targetToken = args.target_token;
  } else {
    try {
      // Don't force a type — use existing project as-is, or create with default type
      targetToken = await getOrCreateProjectToken(
        args.target_project_name,
        config,
      );
    } catch (e: any) {
      return {
        content: [
          { type: "text", text: `Failed to get target token: ${e.message}` },
        ],
        isError: true,
      };
    }
  }

  // ── Step 5: Determine clone mode ──────────────────────────────────────
  //
  // All modes use Percy CLI (auto-installed in step 3) and the SAME target project.
  //   1. URL-named snapshots → `percy snapshot` (re-renders with full DOM/CSS/JS)
  //   2. Non-URL snapshots → `percy upload` (uploads screenshots directly)
  // Both modes work with any project type — Percy CLI handles API details.
  //

  const hasUrlNames = snapshots.some(
    (s) => s.name.startsWith("http://") || s.name.startsWith("https://"),
  );

  if (!hasCli) {
    output += `Percy CLI is required for cloning but could not be installed.\n`;
    output += `Install manually: \`npm install -g @percy/cli\`\n`;
    return { content: [{ type: "text", text: output }] };
  }

  if (hasUrlNames) {
    return await replayWithPercyCli(
      output,
      snapshots,
      targetToken,
      branch,
      args.target_project_name,
    );
  }

  // Non-URL snapshots: download screenshots → percy upload
  return await uploadScreenshots(
    output,
    snapshots,
    targetToken,
    branch,
    args.target_project_name,
  );
}

// ── URL Replay (Percy CLI) ──────────────────────────────────────────────────

async function replayWithPercyCli(
  output: string,
  snapshots: SnapshotInfo[],
  token: string,
  branch: string,
  projectName: string,
): Promise<CallToolResult> {
  output += `### Mode: URL Replay (Percy CLI)\n\n`;
  output += `**Project:** ${projectName}\n`;
  output += `Percy CLI will re-snapshot each page with full resource discovery.\n\n`;

  let yamlContent = "";
  const uniqueNames = new Set<string>();

  for (const snap of snapshots) {
    if (uniqueNames.has(snap.name)) continue;
    uniqueNames.add(snap.name);

    const name = snap.displayName || snap.name;
    const widths = snap.widths.length > 0 ? snap.widths : [1280];

    yamlContent += `- name: "${name}"\n`;
    if (snap.name.startsWith("http://") || snap.name.startsWith("https://")) {
      yamlContent += `  url: ${snap.name}\n`;
    } else {
      yamlContent += `  url: "UNKNOWN"\n`;
    }
    yamlContent += `  waitForTimeout: 3000\n`;
    if (snap.enableJavascript) {
      yamlContent += `  enableJavaScript: true\n`;
    }
    if (snap.testCase) {
      yamlContent += `  testCase: "${snap.testCase}"\n`;
    }
    yamlContent += `  widths:\n`;
    widths.forEach((w) => {
      yamlContent += `    - ${w}\n`;
    });
  }

  const hasUrls = snapshots.some(
    (s) => s.name.startsWith("http://") || s.name.startsWith("https://"),
  );

  if (!hasUrls) {
    output += `**Snapshots don't have URL names.** Use \`percy_create_build\` with URLs instead.\n`;
    output += `\nSnapshot names:\n`;
    for (const snap of snapshots.slice(0, 10)) {
      output += `- ${snap.displayName || snap.name} (${snap.widths.join(", ")}px)\n`;
    }
    return { content: [{ type: "text", text: output }] };
  }

  const tmpDir = await mkdtemp(join(tmpdir(), "percy-clone-"));
  const configPath = join(tmpDir, "snapshots.yml");
  await writeFile(configPath, yamlContent);

  const child = spawn("npx", ["@percy/cli", "snapshot", configPath], {
    env: { ...process.env, PERCY_TOKEN: token, PERCY_BRANCH: branch },
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
    const timeout = setTimeout(resolve, 30000);
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

  setTimeout(async () => {
    try {
      await unlink(configPath);
    } catch {
      /* ignore */
    }
  }, 120000);

  output += `**Replaying ${uniqueNames.size} snapshots...**\n\n`;

  if (buildUrl) {
    output += `**Build URL:** ${buildUrl}\n\n`;
    output += `Percy CLI is re-snapshotting with full resource discovery.\n`;
    output += `Results ready in 1-3 minutes.\n`;
  } else {
    const percyLines = stdoutData
      .split("\n")
      .filter((l) => l.includes("[percy"))
      .slice(0, 10);
    if (percyLines.length > 0) {
      output += `**Percy output:**\n\`\`\`\n${percyLines.join("\n")}\n\`\`\`\n`;
    } else {
      output += `Percy is processing in background. Check dashboard.\n`;
    }
  }

  return { content: [{ type: "text", text: output }] };
}

// ── Screenshot Upload (percy upload) ────────────────────────────────────────
//
// Downloads rendered screenshots from source build, saves to temp directory,
// then uses `percy upload` to create a build in the target project.
// Works with ANY project type — Percy CLI handles all API details.
//
// Flow:
//   1. Download screenshots from source comparisons
//   2. Save as named image files in temp directory
//   3. Run `percy upload ./dir` with target token
//   4. Percy CLI creates build, snapshots, comparisons, uploads tiles
//

async function uploadScreenshots(
  output: string,
  snapshots: SnapshotInfo[],
  token: string,
  branch: string,
  projectName: string,
): Promise<CallToolResult> {
  output += `### Mode: Screenshot Upload (percy upload)\n\n`;
  output += `**Project:** ${projectName}\n`;
  output += `Downloading screenshots and uploading via Percy CLI.\n\n`;

  // Step 1: Create temp directory for screenshots
  const tmpDir = await mkdtemp(join(tmpdir(), "percy-clone-"));
  let downloaded = 0;

  // Step 2: Download screenshots — use first comparison per snapshot (primary width)
  for (const snap of snapshots) {
    const comp = snap.comparisons.find((c) => c.imageUrl);
    if (!comp?.imageUrl) continue;

    try {
      const imgResponse = await fetch(comp.imageUrl);
      if (!imgResponse.ok) continue;

      const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());

      // Name file after snapshot — sanitize for filesystem
      const safeName = snap.name
        .replace(/[/\\?%*:|"<>]/g, "-")
        .replace(/\s+/g, "_")
        .slice(0, 200);
      const ext =
        comp.imageUrl.includes(".jpg") || comp.imageUrl.includes("jpeg")
          ? ".jpg"
          : ".png";
      await writeFile(join(tmpDir, `${safeName}${ext}`), imgBuffer);
      downloaded++;
    } catch {
      output += `- Failed to download: ${snap.name}\n`;
    }
  }

  output += `Downloaded **${downloaded}/${snapshots.length}** screenshots.\n\n`;

  if (downloaded === 0) {
    output += `No screenshots to upload.\n`;
    return { content: [{ type: "text", text: output }] };
  }

  // Step 3: Run percy upload
  output += `Uploading via Percy CLI...\n\n`;

  const child = spawn(
    "npx",
    ["@percy/cli", "upload", tmpDir, "--strip-extensions"],
    {
      env: {
        ...process.env,
        PERCY_TOKEN: token,
        PERCY_BRANCH: branch,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stdoutData = "";
  let buildUrl = "";

  child.stdout?.on("data", (d: Buffer) => {
    const text = d.toString();
    stdoutData += text;
    const match = text.match(/https:\/\/percy\.io\/[^\s]+\/builds\/\d+/);
    if (match) buildUrl = match[0];
  });
  child.stderr?.on("data", (d: Buffer) => {
    stdoutData += d.toString();
  });

  // Wait for completion (up to 60s)
  const exitCode = await new Promise<number | null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), 60000);
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });

  // Clean up temp files
  setTimeout(async () => {
    try {
      const { rm } = await import("fs/promises");
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
  }, 5000);

  // Parse output
  const percyLines = stdoutData
    .split("\n")
    .filter((l) => l.includes("[percy"))
    .slice(0, 15);

  if (buildUrl) {
    output += `**Build created successfully.**\n\n`;
    output += `**View:** ${buildUrl}\n\n`;
  }

  if (exitCode === 0) {
    output += `Percy upload completed. ${downloaded} snapshots uploaded.\n`;
  } else if (exitCode !== null) {
    output += `Percy upload exited with code ${exitCode}.\n`;
  } else {
    output += `Percy upload timed out (60s). Build may still be processing.\n`;
  }

  if (percyLines.length > 0) {
    output += `\n**Percy output:**\n\`\`\`\n${percyLines.join("\n")}\n\`\`\`\n`;
  }

  // List cloned snapshots
  output += `\n**Snapshots:**\n`;
  for (const snap of snapshots) {
    const hasImage = snap.comparisons.some((c) => c.imageUrl);
    output += `- ${hasImage ? "+" : "-"} ${snap.name}\n`;
  }

  return { content: [{ type: "text", text: output }] };
}
