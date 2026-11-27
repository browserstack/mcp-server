/**
 * L3 case table. Each tool has one ToolSpec. A spec expands to one row for each kind:
 *
 *   happy         mock 200        result OK; remote text inside the untrusted markers
 *   bad-input     no mock         validation error; no HTTP call
 *   auth          mock 401        clear error; no access key in the text
 *   server-error  mock 500        clear error; no stack trace
 *   region        EU account      every call goes to an EU host
 *
 * A kind that does not apply is the string "n/a: <reason>". The meta test reports a tool
 * in tools/list with no row for a kind.
 */
import type { Profile } from "./server.js";
import { E2E_ACCESS_KEY } from "./server.js";

export const KINDS = [
  "happy",
  "bad-input",
  "auth",
  "server-error",
  "region",
] as const;
export type Kind = (typeof KINDS)[number];

export type NotApplicable = `n/a: ${string}`;
export const isNA = (v: unknown): v is NotApplicable =>
  typeof v === "string" && v.startsWith("n/a: ");

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "ANY";

/** One mocked upstream answer. A string url matches exactly; a RegExp matches the full URL. */
export interface HttpStub {
  method: Method;
  url: string | RegExp;
  status?: number;
  /** JSON body. Use `text` for a plain-text body. */
  body?: unknown;
  text?: string;
  /** Answer only once; the next matching stub answers the next call. */
  once?: boolean;
}

export interface Expect {
  isError: boolean;
  /** Every pattern must match the result text. */
  textMatches?: RegExp[];
  /** No string may appear in the result text. */
  textNotContains?: string[];
  /** Each string must appear in the text, and only inside an untrusted block. */
  untrusted?: string[];
  /** The tool must make no HTTP call. */
  noHttp?: boolean;
  /** Every HTTP call must go to a host that matches one of these. At least one call. */
  hosts?: RegExp[];
  /** Each of these calls must be made (method + full URL pattern). */
  calls?: { method: Exclude<Method, "ANY">; url: RegExp }[];
}

export interface CaseOverride {
  args?: Record<string, unknown>;
  http?: HttpStub[];
  expect?: Partial<Expect>;
}

export interface ToolSpec {
  tool: string;
  /** Valid arguments. Used by happy, auth, server-error and region. */
  args: Record<string, unknown>;
  /** Upstream answers for the happy path (and for region, unless it has its own). */
  http: HttpStub[];
  happy: Expect | NotApplicable;
  /** Default: arguments built from the schema to break it, expect a validation error. */
  badInput?: CaseOverride | NotApplicable;
  /** Default: every URL answers 401. */
  auth?: CaseOverride | NotApplicable;
  /** Default: every URL answers 500. */
  serverError?: CaseOverride | NotApplicable;
  /** No default: a tool that calls BrowserStack states its EU hosts or why not. */
  region?: (CaseOverride & { hosts: RegExp[] }) | NotApplicable;
  /** Default: both profiles. */
  profiles?: Profile[];
  /**
   * A row that fails because of a real bug in src. The row runs as an expected failure,
   * so it turns red when the bug is fixed. Give the ticket or a short reason.
   */
  knownIssues?: Partial<Record<Kind, string>>;
}

/** A row to run. `args: "auto"` = built from the tool's input schema at run time. */
export interface Row {
  id: string;
  tool: string;
  kind: Kind;
  args: Record<string, unknown> | "auto";
  http: HttpStub[];
  expect: Expect;
  knownIssue?: string;
}

export type Expanded =
  | Row
  | { id: string; tool: string; kind: Kind; na: string };

/** Hosts of the EU region (api-eu-only, test-management-eu, api-accessibility-eu, ...). */
export const EU_HOST = /-eu(-only)?\.browserstack\.com$/;

/** A stack frame such as "    at fn (/path/file.ts:10:5)". */
export const STACK_FRAME = /\n\s+at .+[(\s]\/?[\w./-]+:\d+:\d+\)?/;

const AUTH_TEXT =
  /credential|access key|auth|unauthori[sz]ed|401|permission|sign in|log in/i;

export function expandSpec(spec: ToolSpec): Expanded[] {
  const id = (kind: Kind) => `${spec.tool} · ${kind}`;
  const na = (kind: Kind, reason: NotApplicable): Expanded => ({
    id: id(kind),
    tool: spec.tool,
    kind,
    na: reason.slice("n/a: ".length),
  });
  const row = (
    kind: Kind,
    base: { args: Row["args"]; http: HttpStub[]; expect: Expect },
    o?: CaseOverride,
  ): Row => ({
    id: id(kind),
    tool: spec.tool,
    kind,
    args: o?.args ?? base.args,
    http: o?.http ?? base.http,
    expect: { ...base.expect, ...o?.expect },
    knownIssue: spec.knownIssues?.[kind],
  });

  const out: Expanded[] = [];

  out.push(
    isNA(spec.happy)
      ? na("happy", spec.happy)
      : row("happy", { args: spec.args, http: spec.http, expect: spec.happy }),
  );

  out.push(
    isNA(spec.badInput)
      ? na("bad-input", spec.badInput)
      : row(
          "bad-input",
          {
            args: "auto",
            http: [],
            expect: {
              isError: true,
              textMatches: [/invalid|validation|required|expected/i],
              noHttp: true,
            },
          },
          spec.badInput,
        ),
  );

  out.push(
    isNA(spec.auth)
      ? na("auth", spec.auth)
      : row(
          "auth",
          {
            args: spec.args,
            http: [
              {
                method: "ANY",
                url: /.*/,
                status: 401,
                body: { error: "Unauthorized" },
              },
            ],
            expect: {
              isError: true,
              textMatches: [AUTH_TEXT],
              textNotContains: [E2E_ACCESS_KEY],
            },
          },
          spec.auth,
        ),
  );

  out.push(
    isNA(spec.serverError)
      ? na("server-error", spec.serverError)
      : row(
          "server-error",
          {
            args: spec.args,
            http: [
              {
                method: "ANY",
                url: /.*/,
                status: 500,
                body: { error: "Internal Server Error" },
              },
            ],
            expect: { isError: true, textNotContains: [E2E_ACCESS_KEY] },
          },
          spec.serverError,
        ),
  );

  if (spec.region === undefined) {
    // Missing on purpose: the meta test reports it.
  } else if (isNA(spec.region)) {
    out.push(na("region", spec.region));
  } else {
    out.push(
      row(
        "region",
        {
          args: spec.args,
          http: spec.http,
          expect: { isError: false, hosts: spec.region.hosts },
        },
        spec.region,
      ),
    );
  }

  return out;
}
