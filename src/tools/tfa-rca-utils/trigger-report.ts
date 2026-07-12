import { apiClient } from "../../lib/apiClient.js";
import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import {
  getO11yBaseUrl,
  getO11yUiBuildUrl,
  RELEASE_READINESS_TRIGGER_PATH,
} from "./constants.js";

export interface TriggerRcaReportArgs {
  buildUuid: string;
  /** Re-run even if a completed report already exists. */
  force?: boolean;
}

/**
 * Domain error carrying a client-safe message. The tool maps these to a
 * `{ isError: true }` envelope; the message never contains credentials.
 */
export class TriggerRcaReportError extends Error {}

/**
 * Trimmed glimpse of the Release Readiness report. The raw o11y response —
 * including the `prs[]` and `workflows[]` arrays — is NEVER echoed; the full
 * report lives on the Test Observability dashboard (`viewReport`).
 */
export interface RcaReportGlimpse {
  state?: string;
  verdict?: string;
  verdictProvisional?: boolean;
  partial?: boolean;
  analyzedCount?: number;
  totalFailedCount?: number;
  totalPrs?: number;
  faultyPrNumbers?: unknown[];
  failureReason?: string;
  /** TRA UI link where the full report lives. */
  viewReport: string;
}

/** Pull a machine error code out of a non-2xx body, wherever it rides. */
function extractErrorCode(data: any): string {
  const candidate =
    data?.code ?? data?.error ?? data?.errorCode ?? data?.message;
  return typeof candidate === "string" ? candidate : "";
}

/** Map a trigger (POST) non-2xx into a clean, group-scope-safe domain error. */
function mapTriggerError(status: number, data: unknown): TriggerRcaReportError {
  const code = extractErrorCode(data);
  if (code.includes("REPO_NOT_CONFIGURED")) {
    return new TriggerRcaReportError(
      "repository not configured for Release Readiness; connect the repo in Test Observability settings",
    );
  }
  if (code.includes("RELEASE_READINESS_NOT_FOUND")) {
    return new TriggerRcaReportError(
      "no Release Readiness report found for this build",
    );
  }
  if (status === 403) {
    return new TriggerRcaReportError(
      "Release Readiness AI is not enabled for this group (plan or feature flag)",
    );
  }
  if (status === 404) {
    return new TriggerRcaReportError("build not found for your group");
  }
  return new TriggerRcaReportError(
    `failed to trigger Release Readiness report (status ${status})`,
  );
}

/**
 * Trigger (or read, when one already exists) the Release Readiness report for
 * a build via the o11y external API, returning a trimmed glimpse. Stateless:
 * nothing persists between calls.
 */
export async function triggerRcaReport(
  args: TriggerRcaReportArgs,
  config: BrowserStackConfig,
): Promise<RcaReportGlimpse> {
  const authString = getBrowserStackAuth(config);
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Basic ${Buffer.from(authString).toString("base64")}`,
  };

  const url =
    getO11yBaseUrl() +
    RELEASE_READINESS_TRIGGER_PATH.replace(
      "{buildUuid}",
      encodeURIComponent(args.buildUuid),
    ) +
    `?force=${args.force === true}`;

  const response = await apiClient.post({
    url,
    headers,
    body: {},
    raise_error: false,
  });

  if (!response.ok) {
    throw mapTriggerError(response.status, response.data);
  }

  const data = response.data ?? {};
  const summary = data.summary ?? {};

  // Trimmed glimpse only — never the raw response, never prs[]/workflows[].
  return {
    state: summary.state ?? data.state,
    verdict: summary.verdict,
    verdictProvisional: summary.verdictProvisional,
    partial: summary.partial,
    analyzedCount: summary.analyzedCount,
    totalFailedCount: summary.totalFailedCount,
    totalPrs: summary.totalPrs,
    faultyPrNumbers: summary.faultyPrNumbers,
    failureReason: summary.failureReason,
    viewReport: getO11yUiBuildUrl(args.buildUuid),
  };
}
