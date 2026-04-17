/**
 * percy_create_app_build — Create an App Percy BYOS (Bring Your Own Screenshots) build.
 *
 * Two modes:
 * 1. Sample mode (use_sample_data=true): auto-generates 3 devices × 2 screenshots
 *    using sharp. Zero setup — just provide a project name.
 * 2. Custom mode (resources_dir): reads your own device folders with device.json + PNGs.
 *
 * Expected directory structure for custom mode:
 *   resources/
 *     iPhone_14_Pro/
 *       device.json   ← { deviceName, osName, osVersion, orientation, deviceScreenSize }
 *       Home.png
 *       Settings.png
 *     Pixel_7/
 *       device.json
 *       Home.png
 */

import {
  percyTokenPost,
  getOrCreateProjectToken,
} from "../../../lib/percy-api/percy-auth.js";
import { BrowserStackConfig } from "../../../lib/types.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  setActiveProject,
  setActiveBuild,
} from "../../../lib/percy-api/percy-session.js";
import { execFile } from "child_process";
import { promisify } from "util";
import { readdir, readFile, stat, writeFile, mkdir } from "fs/promises";
import { join, basename, extname } from "path";
import { tmpdir } from "os";
import { createHash } from "crypto";
import sharp from "sharp";

const execFileAsync = promisify(execFile);

// ── Types ───────────────────────────────────────────────────────────────────

interface DeviceConfig {
  deviceName: string;
  osName: string;
  osVersion?: string;
  orientation?: string;
  deviceScreenSize: string; // "WIDTHxHEIGHT"
  statusBarHeight?: number;
  navBarHeight?: number;
}

interface DeviceEntry {
  folder: string;
  config: DeviceConfig;
  screenshots: string[];
  width: number;
  height: number;
}

export interface CreateAppBuildArgs {
  project_name: string;
  resources_dir?: string;
  use_sample_data?: boolean;
  branch?: string;
  test_case?: string;
}

// ── Built-in sample devices ─────────────────────────────────────────────────

const SAMPLE_DEVICES: {
  folder: string;
  config: DeviceConfig;
  screenshots: string[];
  background: { r: number; g: number; b: number };
}[] = [
  {
    folder: "iPhone_14_Pro",
    config: {
      deviceName: "iPhone 14 Pro",
      osName: "iOS",
      osVersion: "16",
      orientation: "portrait",
      deviceScreenSize: "1179x2556",
      statusBarHeight: 132,
      navBarHeight: 0,
    },
    screenshots: ["Home Screen", "Login Screen"],
    background: { r: 230, g: 230, b: 250 }, // light lavender
  },
  {
    folder: "Pixel_7",
    config: {
      deviceName: "Pixel 7",
      osName: "Android",
      osVersion: "13",
      orientation: "portrait",
      deviceScreenSize: "1080x2400",
      statusBarHeight: 118,
      navBarHeight: 63,
    },
    screenshots: ["Home Screen", "Login Screen"],
    background: { r: 230, g: 250, b: 230 }, // light green
  },
  {
    folder: "Samsung_Galaxy_S23",
    config: {
      deviceName: "Samsung Galaxy S23",
      osName: "Android",
      osVersion: "13",
      orientation: "portrait",
      deviceScreenSize: "1080x2340",
      statusBarHeight: 110,
      navBarHeight: 63,
    },
    screenshots: ["Home Screen", "Login Screen"],
    background: { r: 250, g: 240, b: 230 }, // light peach
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

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

function parseDimensions(sizeStr: string): [number, number] | null {
  const match = sizeStr.match(/^(\d+)\s*[xX×]\s*(\d+)$/);
  if (!match) return null;
  return [parseInt(match[1], 10), parseInt(match[2], 10)];
}

function readPngDimensions(
  buffer: Buffer,
): { width: number; height: number } | null {
  if (
    buffer.length >= 24 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }
  return null;
}

// ── Sample data generation ──────────────────────────────────────────────────

async function generateSampleResources(): Promise<string> {
  const ts = Date.now();
  const tmpDir = join(tmpdir(), `percy-app-samples-${ts}`);
  await mkdir(tmpDir, { recursive: true });

  for (const device of SAMPLE_DEVICES) {
    const deviceDir = join(tmpDir, device.folder);
    await mkdir(deviceDir, { recursive: true });

    // Write device.json
    await writeFile(
      join(deviceDir, "device.json"),
      JSON.stringify(device.config, null, 2),
    );

    // Generate PNGs at correct dimensions
    const dims = parseDimensions(device.config.deviceScreenSize)!;
    const [width, height] = dims;

    for (const name of device.screenshots) {
      await sharp({
        create: {
          width,
          height,
          channels: 3,
          background: device.background,
        },
      })
        .png({ compressionLevel: 9 })
        .toFile(join(deviceDir, `${name}.png`));
    }
  }

  return tmpDir;
}

// ── Discovery: find device folders ──────────────────────────────────────────

async function discoverDevices(
  resourcesDir: string,
): Promise<{ devices: DeviceEntry[]; errors: string[] }> {
  const devices: DeviceEntry[] = [];
  const errors: string[] = [];

  let entries: string[];
  try {
    entries = await readdir(resourcesDir);
  } catch (e: any) {
    return {
      devices: [],
      errors: [`Cannot read "${resourcesDir}": ${e.message}`],
    };
  }

  for (const entry of entries) {
    const folderPath = join(resourcesDir, entry);
    const folderStat = await stat(folderPath).catch(() => null);
    if (!folderStat?.isDirectory()) continue;

    // Must have device.json
    const configPath = join(folderPath, "device.json");
    const configExists = await stat(configPath).catch(() => null);
    if (!configExists) continue;

    // Parse device.json
    let deviceConfig: DeviceConfig;
    try {
      const raw = await readFile(configPath, "utf-8");
      deviceConfig = JSON.parse(raw);
    } catch (e: any) {
      errors.push(`${entry}: invalid device.json — ${e.message}`);
      continue;
    }

    // Validate required fields
    if (!deviceConfig.deviceName) {
      errors.push(`${entry}: device.json missing "deviceName"`);
      continue;
    }
    if (!deviceConfig.osName) {
      errors.push(`${entry}: device.json missing "osName"`);
      continue;
    }
    if (!deviceConfig.deviceScreenSize) {
      errors.push(`${entry}: device.json missing "deviceScreenSize"`);
      continue;
    }

    const dims = parseDimensions(deviceConfig.deviceScreenSize);
    if (!dims) {
      errors.push(
        `${entry}: invalid deviceScreenSize "${deviceConfig.deviceScreenSize}" — expected "WIDTHxHEIGHT"`,
      );
      continue;
    }

    // Find .png screenshots
    const allFiles = await readdir(folderPath);
    const screenshots = allFiles
      .filter((f) => /\.png$/i.test(f))
      .map((f) => join(folderPath, f));

    if (screenshots.length === 0) {
      errors.push(`${entry}: no .png files found`);
      continue;
    }

    devices.push({
      folder: entry,
      config: deviceConfig,
      screenshots,
      width: dims[0],
      height: dims[1],
    });
  }

  return { devices, errors };
}

// ── Main handler ────────────────────────────────────────────────────────────

export async function percyCreateAppBuildV2(
  args: CreateAppBuildArgs,
  config: BrowserStackConfig,
): Promise<CallToolResult> {
  const branch = args.branch || (await getGitBranch());
  const commitSha = await getGitSha();
  const usingSamples = args.use_sample_data === true || !args.resources_dir;

  // ── 1. Resolve resources directory ────────────────────────────────────────
  let resourcesDir: string;
  if (usingSamples) {
    try {
      resourcesDir = await generateSampleResources();
    } catch (e: any) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to generate sample data: ${e.message}\n\nMake sure \`sharp\` is installed: \`npm install sharp\``,
          },
        ],
        isError: true,
      };
    }
  } else {
    resourcesDir = args.resources_dir!;
  }

  // ── 2. Get app project token ──────────────────────────────────────────────
  let token: string;
  try {
    token = await getOrCreateProjectToken(args.project_name, config, "app");
    setActiveProject({ name: args.project_name, token, type: "app" });
  } catch (e: any) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to access app project "${args.project_name}": ${e.message}\n\nMake sure the project exists or your BrowserStack credentials have permission to create app Percy projects.`,
        },
      ],
      isError: true,
    };
  }

  // ── 3. Discover devices & screenshots ─────────────────────────────────────
  const { devices, errors: discoveryErrors } =
    await discoverDevices(resourcesDir);

  if (devices.length === 0) {
    let output = `## App Percy Build — No Valid Devices\n\n`;
    output += `No device folders with valid device.json found in \`${resourcesDir}\`.\n\n`;
    if (discoveryErrors.length > 0) {
      output += `**Errors:**\n`;
      for (const err of discoveryErrors) {
        output += `- ${err}\n`;
      }
    }
    output += `\n**Expected structure:**\n`;
    output += `\`\`\`\nresources/\n  iPhone_14_Pro/\n    device.json\n    Home.png\n  Pixel_7/\n    device.json\n    Home.png\n\`\`\`\n`;
    output += `\n**device.json format:**\n`;
    output += `\`\`\`json\n{\n  "deviceName": "iPhone 14 Pro",\n  "osName": "iOS",\n  "osVersion": "16",\n  "orientation": "portrait",\n  "deviceScreenSize": "1290x2796"\n}\n\`\`\`\n`;
    return { content: [{ type: "text", text: output }], isError: true };
  }

  const totalScreenshots = devices.reduce(
    (sum, d) => sum + d.screenshots.length,
    0,
  );

  // ── 4. Create build ───────────────────────────────────────────────────────
  let buildId: string;
  let buildUrl: string;
  try {
    const buildResponse = await percyTokenPost("/builds", token, {
      data: {
        type: "builds",
        attributes: { branch, "commit-sha": commitSha },
        relationships: { resources: { data: [] } },
      },
    });
    buildId = buildResponse?.data?.id;
    buildUrl = buildResponse?.data?.attributes?.["web-url"] || "";

    // Store in session
    if (buildId) {
      setActiveBuild({ id: buildId, url: buildUrl, branch });
    }

    if (!buildId) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to create app build — no build ID returned.",
          },
        ],
        isError: true,
      };
    }
  } catch (e: any) {
    return {
      content: [
        { type: "text", text: `Failed to create app build: ${e.message}` },
      ],
      isError: true,
    };
  }

  // ── 5. Upload screenshots per device ──────────────────────────────────────
  let output = `## App Percy Build — ${args.project_name}\n\n`;
  if (usingSamples) {
    output += `> Using built-in sample data (3 devices × 2 screenshots). Pass \`resources_dir\` for custom screenshots.\n\n`;
  }
  output += `| Field | Value |\n|---|---|\n`;
  output += `| **Build ID** | ${buildId} |\n`;
  output += `| **Project** | ${args.project_name} |\n`;
  output += `| **Branch** | ${branch} |\n`;
  output += `| **Devices** | ${devices.length} |\n`;
  output += `| **Screenshots** | ${totalScreenshots} |\n`;
  output += `| **Token** | \`${token.slice(0, 8)}...${token.slice(-4)}\` |\n`;
  if (buildUrl) output += `| **Build URL** | ${buildUrl} |\n`;
  output += "\n";

  if (discoveryErrors.length > 0) {
    output += `**Skipped (validation errors):**\n`;
    for (const err of discoveryErrors) {
      output += `- ${err}\n`;
    }
    output += `\n`;
  }

  let uploaded = 0;
  let failed = 0;

  for (const device of devices) {
    const dc = device.config;
    output += `### ${dc.deviceName}`;
    if (dc.osName)
      output += ` (${dc.osName}${dc.osVersion ? ` ${dc.osVersion}` : ""})`;
    if (dc.orientation) output += ` — ${dc.orientation}`;
    output += `\n`;

    for (const screenshotPath of device.screenshots) {
      const screenshotName = basename(
        screenshotPath,
        extname(screenshotPath),
      ).replace(/[-_]/g, " ");

      try {
        const content = await readFile(screenshotPath);
        const sha = createHash("sha256").update(content).digest("hex");

        // Validate PNG dimensions match device config
        const pngDims = readPngDimensions(content);
        if (pngDims) {
          if (
            pngDims.width !== device.width ||
            pngDims.height !== device.height
          ) {
            output += `- ✗ **${screenshotName}** — dimension mismatch: image is ${pngDims.width}x${pngDims.height}, device.json expects ${device.width}x${device.height}\n`;
            failed++;
            continue;
          }
        }

        const base64 = content.toString("base64");

        // Create snapshot
        const snapAttrs: Record<string, unknown> = { name: screenshotName };
        if (args.test_case) snapAttrs["test-case"] = args.test_case;

        const snapRes = await percyTokenPost(
          `/builds/${buildId}/snapshots`,
          token,
          { data: { type: "snapshots", attributes: snapAttrs } },
        );
        const snapId = snapRes?.data?.id;
        if (!snapId) {
          output += `- ✗ **${screenshotName}** — snapshot creation failed\n`;
          failed++;
          continue;
        }

        // Create comparison with device tag
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
                      name: dc.deviceName,
                      width: device.width,
                      height: device.height,
                      "os-name": dc.osName,
                      ...(dc.osVersion ? { "os-version": dc.osVersion } : {}),
                      orientation: dc.orientation || "portrait",
                    },
                  },
                },
                tiles: {
                  data: [
                    {
                      attributes: {
                        sha,
                        "status-bar-height": dc.statusBarHeight || 0,
                        "nav-bar-height": dc.navBarHeight || 0,
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
          output += `- ✗ **${screenshotName}** — comparison creation failed\n`;
          failed++;
          continue;
        }

        // Upload tile
        await percyTokenPost(`/comparisons/${compId}/tiles`, token, {
          data: { attributes: { "base64-content": base64 } },
        });

        // Finalize comparison
        await percyTokenPost(`/comparisons/${compId}/finalize`, token, {});

        uploaded++;
        output += `- ✓ **${screenshotName}** (${device.width}×${device.height})\n`;
      } catch (e: any) {
        output += `- ✗ **${screenshotName}** — ${e.message}\n`;
        failed++;
      }
    }
    output += `\n`;
  }

  // ── 6. Finalize build ─────────────────────────────────────────────────────
  try {
    await percyTokenPost(`/builds/${buildId}/finalize`, token, {});
    output += `---\n\n**Build finalized.** ${uploaded}/${totalScreenshots} snapshots uploaded`;
    if (failed > 0) output += `, ${failed} failed`;
    output += `.\n`;
  } catch (e: any) {
    output += `---\n\n**Finalize failed:** ${e.message}\n`;
  }

  if (buildUrl) {
    output += `\n**View build:** ${buildUrl}\n`;
  }

  output += `\n### Next Steps\n\n`;
  output += `- \`percy_get_build\` with build_id "${buildId}" — View build details\n`;
  output += `- \`percy_get_build\` with build_id "${buildId}" and detail "snapshots" — List snapshots\n`;
  output += `- \`percy_get_build\` with build_id "${buildId}" and detail "ai_summary" — AI analysis\n`;
  output += `- \`percy_get_builds\` — List all builds for this project\n`;

  return { content: [{ type: "text", text: output }] };
}
