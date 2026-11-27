/**
 * Runs one L3 row: set the MSW answers, call the tool through the MCP client, and check
 * the result. Returns a list of problems (empty = pass), so a failure shows all of them.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { http, HttpResponse, type RequestHandler } from "msw";
import type { HttpStub, Row } from "./cases.js";
import { STACK_FRAME } from "./cases.js";
import { recordedCalls, resetMsw, unhandledRequests } from "./msw.js";
import { E2E_ACCESS_KEY } from "./server.js";

const UNTRUSTED_BLOCK =
  /«UNTRUSTED [^»\n]{0,80} ([0-9a-f]{12})»\n[\s\S]*?\n«END UNTRUSTED \1»/g;

function toHandler(stub: HttpStub): RequestHandler {
  const method =
    stub.method === "ANY" ? "all" : (stub.method.toLowerCase() as "get");
  // MSW matches a string as a path pattern; an exact URL with a query must be a RegExp.
  const matcher =
    typeof stub.url === "string"
      ? new RegExp(
          `^${stub.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\?.*)?$`,
        )
      : stub.url;
  return http[method](
    matcher,
    () =>
      stub.text !== undefined
        ? new HttpResponse(stub.text, { status: stub.status ?? 200 })
        : HttpResponse.json((stub.body ?? {}) as object, {
            status: stub.status ?? 200,
          }),
    { once: stub.once },
  );
}

/** Arguments that break the schema: drop required fields, or give a wrong type. */
export function badArgsFor(tool: Tool): Record<string, unknown> | undefined {
  const schema = tool.inputSchema as {
    properties?: Record<string, { type?: string | string[] }>;
    required?: string[];
  };
  if (schema.required?.length) return {};
  const props = Object.entries(schema.properties ?? {});
  for (const [name, prop] of props) {
    const types = ([] as string[]).concat(prop.type ?? []);
    if (types.length && !types.includes("object"))
      return { [name]: { not: "valid" } };
    if (types.length && !types.includes("number")) return { [name]: 12345 };
  }
  return undefined;
}

export interface CallOutcome {
  isError: boolean;
  text: string;
  /** The client call threw (a protocol error), instead of returning a result. */
  threw: boolean;
}

export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<CallOutcome> {
  try {
    const result = await client.callTool({ name, arguments: args });
    const content = (result.content ?? []) as { type: string; text?: string }[];
    const text = content
      .map((c) => (c.type === "text" ? (c.text ?? "") : `[${c.type}]`))
      .join("\n");
    return { isError: Boolean(result.isError), text, threw: false };
  } catch (error) {
    return {
      isError: true,
      text: error instanceof Error ? error.message : String(error),
      threw: true,
    };
  }
}

export async function runRow(
  client: Client,
  row: Row,
  tools: Map<string, Tool>,
): Promise<string[]> {
  const problems: string[] = [];
  let args = row.args;
  if (args === "auto") {
    const tool = tools.get(row.tool);
    const generated = tool && badArgsFor(tool);
    if (!generated) {
      return [
        `cannot build bad input from the schema of ${row.tool}: give badInput.args, or n/a`,
      ];
    }
    args = generated;
  }

  resetMsw(row.http.map(toHandler));
  const out = await callTool(client, row.tool, args);
  const calls = recordedCalls();
  const e = row.expect;
  const short = out.text.length > 600 ? `${out.text.slice(0, 600)}…` : out.text;

  if (out.isError !== e.isError) {
    problems.push(
      `isError is ${out.isError}, expected ${e.isError}. Text: ${short}`,
    );
  }
  for (const re of e.textMatches ?? []) {
    if (!re.test(out.text))
      problems.push(`text does not match ${re}. Text: ${short}`);
  }
  // On every row: the access key never reaches the client.
  for (const s of [E2E_ACCESS_KEY, ...(e.textNotContains ?? [])]) {
    if (out.text.includes(s)) problems.push(`text contains "${s}"`);
  }
  if (row.kind === "server-error" && STACK_FRAME.test(out.text)) {
    problems.push(`text contains a stack trace: ${short}`);
  }
  if (e.untrusted?.length) {
    const outside = out.text.replace(UNTRUSTED_BLOCK, "");
    for (const s of e.untrusted) {
      if (!out.text.includes(s))
        problems.push(`remote text "${s}" is not in the result`);
      else if (outside.includes(s))
        problems.push(`remote text "${s}" is outside the untrusted markers`);
    }
  }
  if (e.noHttp && calls.length) {
    problems.push(
      `expected no HTTP call, got: ${calls.map((c) => `${c.method} ${c.url}`).join(", ")}`,
    );
  }
  if (e.hosts) {
    if (!calls.length)
      problems.push("expected HTTP calls to check the host, got none");
    for (const c of calls) {
      if (!e.hosts.some((h) => h.test(c.url.host))) {
        problems.push(
          `call to ${c.url.host} (${c.method} ${c.url.pathname}) does not match ${e.hosts.join(" | ")}`,
        );
      }
    }
  }
  for (const want of e.calls ?? []) {
    if (
      !calls.some(
        (c) => c.method === want.method && want.url.test(c.url.toString()),
      )
    ) {
      problems.push(
        `no ${want.method} call matched ${want.url}. Calls: ${calls.map((c) => `${c.method} ${c.url}`).join(", ") || "none"}`,
      );
    }
  }
  const unknown = unhandledRequests();
  if (unknown.length)
    problems.push(`unknown URL (no mock): ${[...new Set(unknown)].join(", ")}`);

  return problems;
}
