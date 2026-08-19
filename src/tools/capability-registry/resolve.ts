/**
 * Invoke one endpoint: page it to completion, find the rows, project them.
 */

import { bind, GroupedArguments } from "./bind.js";
import { itemsOf, projectRow, rowFields, totalOf } from "./envelope.js";
import { authHeaders, Credentials, Transport } from "./egress.js";
import { InvocationError } from "./index-loader.js";
import { Capability, PagingRule } from "./types.js";

/** A backstop, not a budget: a runaway pager is a bug, and 60 pages is past any real read. */
export const MAX_PAGES = 60;

export interface InvokeResult {
  ok: boolean;
  count: number;
  items: Record<string, unknown>[];
  complete: boolean;
  requests_made: number;
  total_reported?: number;
  truncated_reason?: "page_cap" | "max_items" | "top_n";
  error?: string;
}

export interface InvokeOptions {
  orderBy?: string;
  topN?: number;
  pageSize?: number;
}

export async function invoke(
  capability: Capability,
  args: GroupedArguments,
  baseUrl: string,
  credentials: Credentials,
  transport: Transport,
  options: InvokeOptions = {},
  paging: PagingRule = {},
): Promise<InvokeResult> {
  if (!baseUrl) throw new InvocationError("no base URL is configured for that product");
  const bound = bind(capability, args);
  const headers = authHeaders(credentials);

  const items: Record<string, unknown>[] = [];
  const declared = rowFields(capability.returns);
  const discover = capability.shape === "discovered";
  let requests = 0;
  let rowsSeen = 0;
  let total: number | undefined;
  let complete = true;
  let truncated: InvokeResult["truncated_reason"];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const query: Record<string, unknown> = { ...bound.query };
    if (paging.page) query[paging.page] = page;
    // Ask for the largest page the operation declares. Paging at the product's default was
    // the 17 Aug failure: 880 projects walked 30 at a time.
    const size = options.pageSize || paging.max;
    if (paging.size && size && !(paging.size in query)) query[paging.size] = size;

    const response = await transport(
      capability.method, `${baseUrl.replace(/\/$/, "")}${bound.path}`,
      headers, query, bound.body,
    );
    requests += 1;

    if (response.status === 0 || response.status < 200 || response.status >= 300) {
      return {
        ok: false, count: items.length, items, complete: false, requests_made: requests,
        error: response.error ||
          `the product answered ${response.status}`,
      };
    }

    const rows = itemsOf(response.body);
    rowsSeen += rows.length;
    total = totalOf(response.body) ?? total;
    for (const row of rows) items.push(projectRow(row, declared, discover));

    if (!paging.page || rows.length === 0) break;
    if (total !== undefined && rowsSeen >= total) break;
    if (page === MAX_PAGES) { complete = false; truncated = "page_cap"; }
  }

  // A DRIFT GUARD, not a retry hint. The product answered with rows and none of them
  // carried a single field this capability declares, which is a registration defect —
  // trying different arguments will not help.
  if (rowsSeen > 0 && items.every((row) => Object.keys(row).length === 0)) {
    return {
      ok: false, count: 0, items: [], complete: false, requests_made: requests,
      error: discover
        ? "capability_shape_empty: the product answered with rows, but every field on them " +
          "was an object, an array, or a name withheld as sensitive."
        : `capability_returns_drift: the product answered with rows, but none of the fields ` +
          `this capability declares (${declared.join(", ") || "none"}) were present.`,
    };
  }

  let out = items;
  if (options.orderBy) {
    const field = options.orderBy.replace(/^-/, "");
    const descending = options.orderBy.startsWith("-");
    if (declared.length > 0 && !declared.includes(field)) {
      throw new InvocationError(
        `order_by must name one of this endpoint's returns fields: ${declared.join(", ")}`,
      );
    }
    // Rows missing the field sort last in either direction rather than crashing on null.
    out = [...items].sort((a, b) => {
      const left = a[field], right = b[field];
      if (left === undefined || left === null) return 1;
      if (right === undefined || right === null) return -1;
      const cmp = left < right ? -1 : left > right ? 1 : 0;
      return descending ? -cmp : cmp;
    });
  }
  if (options.topN && options.topN > 0 && out.length > options.topN) {
    out = out.slice(0, options.topN);
    truncated = truncated || "top_n";
  }

  return {
    ok: true, count: out.length, items: out, complete, requests_made: requests,
    ...(total !== undefined ? { total_reported: total } : {}),
    ...(truncated ? { truncated_reason: truncated } : {}),
  };
}
