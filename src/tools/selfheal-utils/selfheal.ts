import { assertOkResponse } from "../../lib/utils.js";
import config from "../../config.js";

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
  const url = `https://api.browserstack.com/automate/sessions/${sessionId}/logs`;

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
    /POST \/session\/[^/]+\/element.*?"using":"css selector","value":"(.*?)"/g;

  // Find all successful healed selectors with their line numbers and context
  const healedSelectors: Array<{
    selector: string;
    lineNumber: number;
    context: { before: string; after: string };
  }> = [];

  logLines.forEach((line, index) => {
    const match = line.match(selfhealPattern);
    if (match) {
      const beforeLine = index > 0 ? logLines[index - 1] : "";
      const afterLine = index < logLines.length - 1 ? logLines[index + 1] : "";

      healedSelectors.push({
        selector: match[1],
        lineNumber: index,
        context: {
          before: beforeLine,
          after: afterLine,
        },
      });
    }
  });

  // Find all selector requests
  const selectorRequests: string[] = [];
  let requestMatch;
  while ((requestMatch = requestPattern.exec(logText)) !== null) {
    selectorRequests.push(requestMatch[1]);
  }

  // Pair each healed selector with its corresponding original selector
  const healedMappings: SelectorMapping[] = [];
  const minLength = Math.min(selectorRequests.length, healedSelectors.length);

  for (let i = 0; i < minLength; i++) {
    healedMappings.push({
      originalSelector: selectorRequests[i],
      healedSelector: healedSelectors[i].selector,
      context: healedSelectors[i].context,
    });
  }

  return healedMappings;
}
