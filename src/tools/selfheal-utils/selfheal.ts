import { assertOkResponse } from "../../lib/utils.js";

interface SelectorMapping {
  originalSelector: string;
  healedSelector: string;
  selectorType: string;
  healedSelectorType: string;
  context: {
    before: string;
    after: string;
  };
}

export interface LocatorRef {
  type: string;
  value: string;
}

export interface HealedSelectorEntry {
  original_locator: LocatorRef;
  healed_locator: LocatorRef;
  timestamp?: string;
  healing_thought?: string;
  healed_element_screenshot_url?: string;
}

export interface HealingLog {
  session_id: string;
  session_name?: string;
  product?: string;
  os?: string;
  browser?: string;
  browser_version?: string;
  healed_selectors: HealedSelectorEntry[];
  healing_attempted_logs?: unknown[];
  session_url?: string;
}

export interface SelfHealingReport {
  report_meta: Record<string, unknown>;
  healing_logs: HealingLog[];
}

import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { apiClient } from "../../lib/apiClient.js";

type SessionType = "automate" | "app-automate";

const SELF_HEAL_REPORT_BASE =
  "https://api-automation.browserstack.com/ext/v1/builds";

/**
 * Fetches the self-healing report for a build via the build-scoped API.
 *
 * Two-step flow:
 *   1. GET /ext/v1/builds/{buildUuid}/selfHealingReport -> { url, expiry }
 *   2. GET <presigned S3 url> -> full report JSON
 *
 * Returns the full report so the caller (LLM) has rich context (metrics,
 * screenshots, healing thoughts) when deciding which selectors to apply.
 */
export async function fetchSelfHealingReportByBuild(
  buildUuid: string,
  config: BrowserStackConfig,
): Promise<SelfHealingReport> {
  if (!buildUuid) {
    throw new Error("buildUuid is required");
  }

  const authString = getBrowserStackAuth(config);
  const auth = Buffer.from(authString).toString("base64");

  const presignedResp = await apiClient.get<Record<string, unknown>>({
    url: `${SELF_HEAL_REPORT_BASE}/${encodeURIComponent(buildUuid)}/selfHealingReport`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
  });
  await assertOkResponse(presignedResp, "self-healing report");

  const presignedUrl = extractPresignedUrl(presignedResp.data);
  if (!presignedUrl) {
    throw new Error(
      "Self-healing report response did not contain a presigned URL",
    );
  }

  const reportResp = await apiClient.get<SelfHealingReport>({
    url: presignedUrl,
  });
  await assertOkResponse(reportResp, "self-healing report payload");

  return reportResp.data;
}

function extractPresignedUrl(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const candidates = ["url", "presigned_url", "signed_url", "s3_url"];
  const obj = payload as Record<string, unknown>;
  for (const key of candidates) {
    const value = obj[key];
    if (typeof value === "string" && /^https?:\/\//.test(value)) {
      return value;
    }
  }
  // Some APIs nest the URL one level deeper (e.g. { data: { url } }).
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const nested = extractPresignedUrl(value);
      if (nested) return nested;
    }
  }
  return undefined;
}

/**
 * Convenience: flatten all healed_selectors across sessions in a report.
 */
export function flattenHealedSelectors(
  report: SelfHealingReport,
): HealedSelectorEntry[] {
  return (report.healing_logs ?? []).flatMap(
    (log) => log.healed_selectors ?? [],
  );
}

export async function getSelfHealSelectors(
  sessionId: string,
  config: BrowserStackConfig,
  sessionType: SessionType = "automate",
) {
  const authString = getBrowserStackAuth(config);
  const auth = Buffer.from(authString).toString("base64");
  const productPath =
    sessionType === "app-automate" ? "app-automate" : "automate";
  const url = `https://api.browserstack.com/${productPath}/sessions/${sessionId}/logs`;

  const response = await apiClient.get({
    url,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
  });

  await assertOkResponse(response, "session logs");
  const logText =
    typeof response.data === "string"
      ? response.data
      : JSON.stringify(response.data);
  return extractHealedSelectors(logText);
}

function extractHealedSelectors(logText: string): SelectorMapping[] {
  // Split log text into lines for easier context handling
  const logLines = logText.split("\n");

  // Pattern to match successful SELFHEAL entries only
  const selfhealPattern =
    /SELFHEAL\s*{\s*"status":"true",\s*"data":\s*{\s*"using":"([^"]+)",\s*"value":"(.*?)"}/;

  // Find all successful healed selectors with their line numbers and context
  const healedMappings: SelectorMapping[] = [];

  for (let i = 0; i < logLines.length; i++) {
    const match = logLines[i].match(selfhealPattern);
    if (!match) {
      continue;
    }

    const beforeLine = i > 0 ? logLines[i - 1] : "";
    const afterLine = i < logLines.length - 1 ? logLines[i + 1] : "";

    const healedSelectorType = normalizeSelectorType(match[1]);
    const healedSelector = cleanSelectorValue(match[2]);

    const requestLine = findClosestRequestLine(logLines, i);
    const requestSelector = requestLine
      ? extractSelectorFromRequest(requestLine)
      : {
          selector: "UNKNOWN",
          selectorType: "unknown",
        };

    healedMappings.push({
      originalSelector: requestSelector.selector,
      healedSelector,
      selectorType: requestSelector.selectorType,
      healedSelectorType,
      context: {
        before: beforeLine,
        after: afterLine,
      },
    });
  }

  return healedMappings;
}

function findClosestRequestLine(
  logLines: string[],
  currentIndex: number,
): string | undefined {
  for (let i = currentIndex - 1; i >= 0; i--) {
    const line = logLines[i];
    if (line.includes("REQUEST") && line.includes('"using"')) {
      return line;
    }

    if (line.includes("SELFHEAL")) {
      break;
    }
  }

  return undefined;
}

function extractSelectorFromRequest(line: string) {
  const usingMatch = line.match(/"using":"([^"]+)"/);
  const valueMatch = line.match(/"value":"(.*?)"/);

  if (usingMatch && valueMatch) {
    return {
      selector: cleanSelectorValue(valueMatch[1]),
      selectorType: normalizeSelectorType(usingMatch[1]),
    };
  }

  return {
    selector: "UNKNOWN",
    selectorType: "unknown",
  };
}

function cleanSelectorValue(value: string) {
  return value.replace(/\\\\/g, "\\");
}

function normalizeSelectorType(value: string) {
  return value ? value.toLowerCase() : "unknown";
}
