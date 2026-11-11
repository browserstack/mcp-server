import { apiClient } from "../../lib/apiClient.js";
import { HttpError } from "../../lib/error.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { getRegionalHost } from "../../lib/regional-host.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { SessionIdRecord } from "../automate-utils/list-session-ids.js";
import logger from "../../logger.js";

/**
 * App Automate builds run through a framework API (Maestro, Espresso, XCUITest,
 * Flutter) have their own build and session endpoints. The generic App Automate
 * session list returns nothing for them and the generic log endpoints return 404;
 * their logs are links on each test case of the framework session.
 */
export const FRAMEWORKS = [
  { name: "maestro", path: "maestro/v2" },
  { name: "espresso", path: "espresso/v2" },
  { name: "xcuitest", path: "xcuitest/v2" },
  { name: "flutter-android", path: "flutter-integration-tests/v2/android" },
  { name: "flutter-ios", path: "flutter-integration-tests/v2/ios" },
] as const;

export type Framework = (typeof FRAMEWORKS)[number];

export interface FrameworkBuild {
  framework: Framework;
  buildId: string;
  data: any;
}

export interface FrameworkTestCase {
  name: string;
  className?: string;
  status?: string;
  /** Link fields as returned: video, maestro_log, instrumentation_log, ... */
  fields: Record<string, unknown>;
}

function headers(config: BrowserStackConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Basic ${Buffer.from(getBrowserStackAuth(config)).toString("base64")}`,
  };
}

function frameworkUrl(framework: Framework, path: string): string {
  return `${getRegionalHost("appAutomateCloud")}/app-automate/${framework.path}/${path}`;
}

async function getJson(url: string, config: BrowserStackConfig) {
  const response = await apiClient.get({
    url,
    headers: headers(config),
    raise_error: false,
  });
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new HttpError(
      `Failed to read ${url.split("/app-automate/")[1] ?? url}: ${response.status} ${response.statusText}`.trim(),
      response.status,
    );
  }
  return response.data;
}

/**
 * The framework build with this id, or undefined if none has it. Each framework's
 * build endpoint returns 404 for another framework's build, so the five lookups
 * run in parallel and at most one answers. Used only as a fallback after an empty
 * or 404 answer, so a failed lookup (401, 403, 5xx) is treated as "not this
 * framework" rather than replacing the caller's original reply with an error.
 */
export async function findFrameworkBuild(
  buildId: string,
  config: BrowserStackConfig,
): Promise<FrameworkBuild | undefined> {
  const id = encodeURIComponent(buildId.trim());
  const results = await Promise.allSettled(
    FRAMEWORKS.map((framework) =>
      getJson(frameworkUrl(framework, `builds/${id}`), config),
    ),
  );
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled" && result.value) {
      return {
        framework: FRAMEWORKS[index],
        buildId: buildId.trim(),
        data: result.value,
      };
    }
    if (result.status === "rejected") {
      logger.debug(
        `framework lookup failed for ${FRAMEWORKS[index].name}: ${result.reason}`,
      );
    }
  }
  return undefined;
}

export function frameworkSessions(build: FrameworkBuild): SessionIdRecord[] {
  const records: SessionIdRecord[] = [];
  for (const device of build.data?.devices ?? []) {
    for (const session of device?.sessions ?? []) {
      if (typeof session?.id !== "string") continue;
      records.push({
        sessionId: session.id,
        status: session.status,
        os: device.os,
        osVersion: device.os_version,
        device: device.device ?? null,
        browserUrl: `https://app-automate.browserstack.com/dashboard/v2/builds/${build.buildId}/sessions/${session.id}`,
      });
    }
  }
  return records;
}

export async function getFrameworkTestCases(
  build: FrameworkBuild,
  sessionId: string,
  config: BrowserStackConfig,
): Promise<FrameworkTestCase[] | undefined> {
  const data = await getJson(
    frameworkUrl(
      build.framework,
      `builds/${encodeURIComponent(build.buildId)}/sessions/${encodeURIComponent(sessionId)}`,
    ),
    config,
  );
  if (!data) return undefined;
  const cases: FrameworkTestCase[] = [];
  for (const group of data?.testcases?.data ?? []) {
    for (const test of group?.testcases ?? []) {
      const { name, status, ...fields } = test ?? {};
      cases.push({
        name: typeof name === "string" ? name : "unnamed test",
        className: typeof group?.class === "string" ? group.class : undefined,
        status: typeof status === "string" ? status : undefined,
        fields,
      });
    }
  }
  return cases;
}

const FAILED = new Set(["failed", "error", "timedout"]);

/** Failed tests first, then the rest, in their original order. */
export function failedFirst(cases: FrameworkTestCase[]): FrameworkTestCase[] {
  return [
    ...cases.filter((c) => FAILED.has(c.status ?? "")),
    ...cases.filter((c) => !FAILED.has(c.status ?? "")),
  ];
}

/** Only BrowserStack hosts get the caller's credentials. */
export function isBrowserStackUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "browserstack.com" ||
        url.hostname.endsWith(".browserstack.com"))
    );
  } catch {
    return false;
  }
}

/** Download a test-case link with the caller's credentials. */
export async function downloadTestCaseFile(
  url: string,
  config: BrowserStackConfig,
  options: { binary?: boolean; maxBytes: number },
) {
  if (!isBrowserStackUrl(url)) {
    throw new Error("refusing to fetch a log link outside browserstack.com");
  }
  const response = await apiClient.get({
    url,
    headers: { Authorization: headers(config).Authorization },
    ...(options.binary ? { responseType: "arraybuffer" as const } : {}),
    maxContentLength: options.maxBytes,
    raise_error: false,
  });
  if (response.status === 413) return { tooLarge: true as const };
  if (!response.ok) {
    throw new HttpError(
      `Failed to download a test log: ${response.status} ${response.statusText}`.trim(),
      response.status,
    );
  }
  return { tooLarge: false as const, data: response.data };
}
