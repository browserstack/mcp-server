import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "fs";
import { BrowserStackConfig } from "../lib/types.js";
import appConfig from "../config.js";
import {
  getAppAutomatePlan,
  listAppAutomateDevices,
  listDedicatedDevices,
  listRecentApps,
  uploadMedia,
  uploadMobileApp,
} from "./device-session-utils/rest.js";
import { registerTool, text } from "./device-session-utils/register-helpers.js";

/**
 * Mobile device catalog: what devices exist, which builds are uploaded, and how
 * much parallel capacity is free. Everything here is plain REST with the user's
 * username:access_key, so it works the same locally and in Remote MCP.
 *
 * Covers device lists, parallel capacity, app and media uploads, and the
 * team's default devices.
 */

interface CatalogDevice {
  platform: string;
  device: string;
  osVersion: string;
  tier?: string;
}

/**
 * App Automate's own device list: authenticated, specific to the account, and
 * named exactly as startDeviceSession expects. (runAppLiveSession keeps its
 * own App Live list internally; agent sessions never run on App Live.)
 */
async function catalogDevices(
  config: BrowserStackConfig,
): Promise<CatalogDevice[]> {
  return (await listAppAutomateDevices(config)).map((d) => ({
    platform: d.os.toLowerCase(),
    device: d.device,
    osVersion: String(d.os_version),
    tier: d.device_tier,
  }));
}

const byVersionDesc = (a: string, b: string) =>
  parseFloat(b) - parseFloat(a) || b.localeCompare(a);

export default function addMobileDeviceTools(
  server: McpServer,
  config: BrowserStackConfig,
) {
  const tools: Record<string, any> = {};

  tools.listMobileDevices = registerTool(server, config, {
    name: "listMobileDevices",
    title: "List Mobile Devices",
    description:
      "List the real iOS/Android devices and OS versions this account can drive on BrowserStack App Automate, with the exact names startDeviceSession expects. Filter by platform, a device name query, or an OS version. Shows what the account can use, not real-time free/busy availability.",
    schema: {
      platform: z.enum(["android", "ios"]).optional(),
      query: z
        .string()
        .optional()
        .describe("Device name to search for, e.g. 'Pixel 8' or 'iPhone 15'."),
      osVersion: z
        .string()
        .optional()
        .describe(
          "Only devices with this OS major version, e.g. '14' or '17'.",
        ),
      limit: z.number().int().min(1).max(200).default(60),
    },
    hints: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    failurePrefix: "Failed to list devices",
    run: async (args) => {
      let devices = await catalogDevices(config);
      if (args.platform)
        devices = devices.filter((d) => d.platform === args.platform);
      if (args.osVersion) {
        const major = Math.floor(parseFloat(args.osVersion));
        devices = devices.filter((d) =>
          Number.isNaN(major)
            ? d.osVersion === args.osVersion
            : Math.floor(parseFloat(d.osVersion)) === major,
        );
      }
      if (args.query) {
        const q = args.query.toLowerCase();
        devices = devices.filter((d) => d.device.toLowerCase().includes(q));
      }

      const grouped = new Map<
        string,
        { platform: string; tier?: string; versions: Set<string> }
      >();
      for (const d of devices) {
        const key = `${d.platform}|${d.device}`;
        const entry = grouped.get(key) ?? {
          platform: d.platform,
          tier: d.tier,
          versions: new Set(),
        };
        entry.versions.add(d.osVersion);
        grouped.set(key, entry);
      }
      const rows = [...grouped.entries()]
        .map(([key, v]) => ({
          platform: v.platform,
          device: key.split("|")[1],
          tier: v.tier,
          versions: [...v.versions].sort(byVersionDesc),
        }))
        .sort(
          (a, b) =>
            a.platform.localeCompare(b.platform) ||
            byVersionDesc(a.versions[0], b.versions[0]) ||
            a.device.localeCompare(b.device),
        );
      if (!rows.length) {
        return text(
          "No devices match those filters. Try a broader query or no osVersion.",
        );
      }
      const shown = rows.slice(0, args.limit);
      return text(
        `${rows.length} device model(s)${rows.length > shown.length ? ` (showing ${shown.length}; narrow with platform/query/osVersion)` : ""}:`,
        ...shown.map(
          (r) =>
            `- [${r.platform}] ${r.device} — OS ${r.versions.join(", ")}${r.tier ? ` (${r.tier})` : ""}`,
        ),
        "\nPass the device name and an OS version to startDeviceSession.",
      );
    },
  });

  tools.listDedicatedDevices = registerTool(server, config, {
    name: "listDedicatedDevices",
    title: "List Private Devices",
    description:
      "List the account's private (dedicated) devices on BrowserStack App Automate. Returns an empty list for accounts without a private device cloud.",
    schema: {},
    hints: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    failurePrefix: "Failed to list dedicated devices",
    run: async () => {
      const devices = await listDedicatedDevices(config);
      if (!devices.length) {
        return text(
          "This account has no private (dedicated) devices. Public devices are listed by listMobileDevices.",
        );
      }
      return text(
        `${devices.length} dedicated device(s):`,
        ...devices.map((d) => {
          const name = d.device ?? d.device_name ?? d.name;
          const os = [d.os, d.os_version].filter(Boolean).join(" ");
          const rest = Object.entries(d)
            .filter(
              ([k]) =>
                !["device", "device_name", "name", "os", "os_version"].includes(
                  k,
                ),
            )
            .map(
              ([k, v]) =>
                `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`,
            )
            .join(", ");
          return `- ${name ?? "(unnamed)"}${os ? ` (${os})` : ""}${rest ? ` — ${rest}` : ""}`;
        }),
      );
    },
  });

  tools.getTeamDefaultDevices = registerTool(server, config, {
    name: "getTeamDefaultDevices",
    title: "Get Team Default Devices",
    description:
      "Return the team's default devices from the shared list configured in BROWSERSTACK_TEAM_DEVICES_FILE, each checked against what this account can run on App Automate. Use these as the default targets for startDeviceSession when the user does not name a device.",
    schema: {},
    hints: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    failurePrefix: "Failed to read team default devices",
    run: async () => {
      const file = appConfig.TEAM_DEVICES_FILE;
      if (!file) {
        return text(
          "No team device list is configured. Set BROWSERSTACK_TEAM_DEVICES_FILE to a JSON file like",
          '[{"platform":"android","device":"Google Pixel 8","osVersion":"14.0"},{"platform":"ios","device":"iPhone 15","osVersion":"17"}]',
        );
      }
      let entries: Array<{
        platform?: string;
        device?: string;
        osVersion?: string;
        note?: string;
      }>;
      try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        entries = Array.isArray(parsed) ? parsed : parsed?.devices;
        if (!Array.isArray(entries))
          throw new Error('expected a JSON array (or {"devices": [...]})');
      } catch (error) {
        throw new Error(
          `Could not read ${file}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const available = await listAppAutomateDevices(config);
      const rows = entries.map((e) => {
        const platform = String(e.platform ?? "").toLowerCase();
        const name = String(e.device ?? "");
        const versions = available
          .filter(
            (d) =>
              d.os.toLowerCase() === platform &&
              d.device.toLowerCase() === name.toLowerCase(),
          )
          .map((d) => String(d.os_version));
        const wanted = e.osVersion ? String(e.osVersion) : undefined;
        const ok =
          versions.length > 0 &&
          (!wanted ||
            versions.includes(wanted) ||
            versions.some((v) => v.split(".")[0] === wanted.split(".")[0]));
        const status = !versions.length
          ? "✗ not available on this account"
          : ok
            ? "✓ available"
            : `✗ OS ${wanted} not available (has ${versions.join(", ")})`;
        return `- [${platform || "?"}] ${name || "(no device)"}${wanted ? ` ${wanted}` : ""} — ${status}${e.note ? ` — ${e.note}` : ""}`;
      });
      return text(
        `${entries.length} team default device(s) from ${file}:`,
        ...rows,
      );
    },
  });

  tools.uploadMobileApp = registerTool(server, config, {
    name: "uploadMobileApp",
    title: "Upload Mobile App",
    description:
      "Upload an app build (.apk, .aab, .ipa) to BrowserStack from a local file or a public https download link to App Automate, and get back its bs:// app URL to pass to startDeviceSession. Local files must be inside MCP_UPLOAD_BASE_DIR.",
    schema: {
      filePath: z
        .string()
        .optional()
        .describe(
          "Absolute path to the build. Must be inside MCP_UPLOAD_BASE_DIR.",
        ),
      url: z
        .string()
        .optional()
        .describe(
          "A public https:// link BrowserStack can download the build from.",
        ),
      customId: z
        .string()
        .max(100)
        .optional()
        .describe(
          "Optional stable name for the build; later sessions can use it in place of the bs:// URL.",
        ),
    },
    hints: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    failurePrefix: "Failed to upload app",
    run: async (args) => {
      const result = await uploadMobileApp(args, config);
      return text(
        `Uploaded. App URL: ${result.app_url}`,
        result.custom_id ? `Custom id: ${result.custom_id}` : undefined,
        "Pass it as `app` to startDeviceSession.",
      );
    },
  });

  tools.listUploadedApps = registerTool(server, config, {
    name: "listUploadedApps",
    title: "List Uploaded Apps",
    description:
      "List app builds already uploaded to BrowserStack App Automate (newest first) with their bs:// URLs, so an existing build can be reused in startDeviceSession instead of uploading again. scope 'mine' = your uploads; 'group' = everyone on your team.",
    schema: {
      scope: z.enum(["mine", "group"]).default("mine"),
      customId: z
        .string()
        .optional()
        .describe("Only builds uploaded under this custom id."),
      limit: z.number().int().min(1).max(100).default(20),
    },
    hints: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    failurePrefix: "Failed to list uploaded apps",
    run: async (args) => {
      const apps = await listRecentApps(args, config);
      if (!apps.length) {
        return text(
          `No uploaded apps found (${args.scope}). Upload one with uploadMobileApp.`,
        );
      }
      return text(
        `${apps.length} uploaded app(s):`,
        ...apps
          .slice(0, args.limit)
          .map(
            (a) =>
              `- ${a.app_name ?? "(unnamed)"}${a.app_version ? ` v${a.app_version}` : ""} — ${a.app_url}${a.custom_id ? ` (custom id ${a.custom_id})` : ""}${a.uploaded_at ? `, uploaded ${a.uploaded_at}` : ""}${a.expiry ? `, expires ${a.expiry}` : ""}`,
          ),
      );
    },
  });

  tools.getAppAutomatePlan = registerTool(server, config, {
    name: "getAppAutomatePlan",
    title: "Get App Automate Plan",
    description:
      "Show the App Automate plan and parallel-session usage (running, maximum, queued). Check it before starting device sessions or a large test run.",
    schema: {},
    hints: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    failurePrefix: "Failed to fetch the App Automate plan",
    run: async () => {
      const p = await getAppAutomatePlan(config);
      return text(
        `Plan: ${p.automate_plan ?? "unknown"}`,
        `Parallel sessions running: ${p.parallel_sessions_running ?? "?"} of ${p.parallel_sessions_max_allowed ?? "?"}` +
          (p.team_parallel_sessions_max_allowed !== undefined
            ? ` (team limit ${p.team_parallel_sessions_max_allowed})`
            : ""),
        `Queued sessions: ${p.queued_sessions ?? "?"} of ${p.queued_sessions_max_allowed ?? "?"}`,
      );
    },
  });

  tools.uploadMediaFile = registerTool(server, config, {
    name: "uploadMediaFile",
    title: "Upload Media File",
    description:
      "Upload an image, video, audio or document file (inside MCP_UPLOAD_BASE_DIR, up to 50 MB) for use on devices, and get back its media:// URL. Pass it to startDeviceSession uploadMedia (preloads it on the device) or to injectCameraImage.",
    schema: {
      filePath: z.string(),
      customId: z.string().max(100).optional(),
    },
    hints: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    failurePrefix: "Failed to upload media",
    run: async (args) => {
      const r = await uploadMedia(args, config);
      return text(
        `Uploaded. Media URL: ${r.media_url}`,
        r.custom_id ? `Custom id: ${r.custom_id}` : undefined,
      );
    },
  });

  return tools;
}
