import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { wrapUntrusted } from "../../lib/untrusted-content.js";

const BODY_SOURCE = "product response body";
const BODY_BLOCK = new RegExp(
  `«UNTRUSTED ${BODY_SOURCE} ([0-9a-f]{12})»\\n([\\s\\S]*)\\n«END UNTRUSTED \\1»$`,
);

type Answer = { http_response: { body?: unknown } } & Record<string, unknown>;

/**
 * An invoke answer as tool content. What the server writes — ok, status, `note`,
 * `narrowed`, `fallback`, `completed` — stays plain JSON in the first block, so the
 * caller can act on it. The product's body carries whatever users wrote (case
 * preconditions, step text, run names, history), so it follows as its own block
 * inside the untrusted-content boundary.
 */
export function answerContent(answer: Answer): CallToolResult["content"] {
  const { body, ...response } = answer.http_response;
  const head = { ...answer, http_response: response };
  return [
    { type: "text", text: JSON.stringify(head) },
    ...(body === undefined
      ? []
      : [
          {
            type: "text" as const,
            text: wrapUntrusted(BODY_SOURCE, JSON.stringify(body)),
          },
        ]),
  ];
}

/**
 * The inverse, for code that drives invokeCapability itself (scripts, tests): the
 * first block's JSON with the body put back under `http_response.body`. A refusal
 * has no body block and comes back as it was.
 */
export function readAnswer(result: CallToolResult): any {
  const [head, next] = result.content;
  const payload = JSON.parse(head.type === "text" ? head.text : "{}");
  const match = next?.type === "text" ? next.text.match(BODY_BLOCK) : null;
  if (match) {
    payload.http_response = {
      ...payload.http_response,
      body: JSON.parse(match[2]),
    };
  }
  return payload;
}
