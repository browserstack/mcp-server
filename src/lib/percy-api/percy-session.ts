/**
 * Percy Session — In-memory state that persists across tool calls.
 *
 * Stores active project token, build context, and org info so
 * subsequent tool calls get richer context automatically.
 */

export interface PercySessionState {
  // Active project
  projectName?: string;
  projectToken?: string;
  projectSlug?: string;
  projectId?: string;
  projectType?: string;

  // Active build
  buildId?: string;
  buildNumber?: string;
  buildUrl?: string;
  buildBranch?: string;

  // Org
  orgSlug?: string;
  orgId?: string;
}

const session: PercySessionState = {};

// ── Setters ─────────────────────────────────────────────────────────────────

export function setActiveProject(opts: {
  name: string;
  token: string;
  slug?: string;
  id?: string;
  type?: string;
}) {
  session.projectName = opts.name;
  session.projectToken = opts.token;
  if (opts.slug) session.projectSlug = opts.slug;
  if (opts.id) session.projectId = opts.id;
  if (opts.type) session.projectType = opts.type;
}

export function setActiveBuild(opts: {
  id: string;
  number?: string;
  url?: string;
  branch?: string;
}) {
  session.buildId = opts.id;
  if (opts.number) session.buildNumber = opts.number;
  if (opts.url) session.buildUrl = opts.url;
  if (opts.branch) session.buildBranch = opts.branch;
}

export function setOrg(opts: { slug?: string; id?: string }) {
  if (opts.slug) session.orgSlug = opts.slug;
  if (opts.id) session.orgId = opts.id;
}

// ── Getters ─────────────────────────────────────────────────────────────────

export function getSession(): PercySessionState {
  return { ...session };
}

export function getActiveToken(): string | undefined {
  return session.projectToken;
}

export function getActiveBuildId(): string | undefined {
  return session.buildId;
}

// ── Formatters (append to tool output) ──────────────────────────────────────

export function formatActiveProject(): string {
  if (!session.projectName) return "";
  const masked = session.projectToken
    ? `${session.projectToken.slice(0, 8)}...${session.projectToken.slice(-4)}`
    : "—";
  let out = `\n### Active Project\n\n`;
  out += `| | |\n|---|---|\n`;
  out += `| **Project** | ${session.projectName} |\n`;
  out += `| **Token** | \`${masked}\` |\n`;
  if (session.projectType) out += `| **Type** | ${session.projectType} |\n`;
  if (session.projectSlug) out += `| **Slug** | ${session.projectSlug} |\n`;
  return out;
}

export function formatActiveBuild(): string {
  if (!session.buildId) return "";
  let out = `\n### Active Build\n\n`;
  out += `| | |\n|---|---|\n`;
  out += `| **Build ID** | ${session.buildId} |\n`;
  if (session.buildNumber) out += `| **Build #** | ${session.buildNumber} |\n`;
  if (session.buildUrl) out += `| **URL** | ${session.buildUrl} |\n`;
  if (session.buildBranch) out += `| **Branch** | ${session.buildBranch} |\n`;
  return out;
}

export function formatSessionSummary(): string {
  const parts: string[] = [];
  if (session.projectName) {
    const masked = session.projectToken
      ? `****${session.projectToken.slice(-4)}`
      : "";
    parts.push(`**Project:** ${session.projectName} (${masked})`);
  }
  if (session.buildId) {
    parts.push(
      `**Build:** #${session.buildNumber || session.buildId}${session.buildUrl ? ` — ${session.buildUrl}` : ""}`,
    );
  }
  return parts.length > 0 ? parts.join(" | ") : "";
}
