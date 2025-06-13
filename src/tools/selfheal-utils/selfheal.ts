import { assertOkResponse } from "../../lib/utils.js";
import config from "../../config.js";
import { DOMAINS } from "../../lib/domains.js";
interface SelectorMapping {
  originalSelector: string;
  healedSelector: string;
  context: {
    before: string;
    after: string;
  };
}

export async function getSelfHealSelectors(sessionId: string) {
  const credentials = `${config.browserstackUsername}:${config.browserstackAccessKey}`;
  const auth = Buffer.from(credentials).toString("base64");
  const url = `${DOMAINS.API_CLOUD}/automate/sessions/${sessionId}/logs`;

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
  });

  await assertOkResponse(response, "session logs");
  const logText = await response.text();
  return extractHealedSelectors(logText);
}

function extractHealedSelectors(logText: string): SelectorMapping[] {
  // Split log text into lines for easier context handling
  const logLines = logText.split("\n");

  // Pattern to match successful SELFHEAL entries only
  const selfhealPattern =
    /SELFHEAL\s*{\s*"status":"true",\s*"data":\s*{\s*"using":"css selector",\s*"value":"(.*?)"}/;

  // Pattern to match preceding selector requests
  const requestPattern =
    /POST \/session\/[^/]+\/element.*?"using":"css selector","value":"(.*?)"/;

  // Find all successful healed selectors with their line numbers and context
  const healedMappings: SelectorMapping[] = [];

  for (let i = 0; i < logLines.length; i++) {
    const match = logLines[i].match(selfhealPattern);
    if (match) {
      const beforeLine = i > 0 ? logLines[i - 1] : "";
      const afterLine = i < logLines.length - 1 ? logLines[i + 1] : "";

      // Look backwards to find the most recent original selector request
      let originalSelector = "UNKNOWN";
      for (let j = i - 1; j >= 0; j--) {
        const requestMatch = logLines[j].match(requestPattern);
        if (requestMatch) {
          originalSelector = requestMatch[1];
          break;
        }
      }

      healedMappings.push({
        originalSelector,
        healedSelector: match[1],
        context: {
          before: beforeLine,
          after: afterLine,
        },
      });
    }
  }

  return healedMappings;
}
