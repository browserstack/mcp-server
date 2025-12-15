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

import { getBrowserStackAuth } from "../../lib/get-auth.js";
import { BrowserStackConfig } from "../../lib/types.js";
import { apiClient } from "../../lib/apiClient.js";

type SessionType = "automate" | "app-automate";

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
