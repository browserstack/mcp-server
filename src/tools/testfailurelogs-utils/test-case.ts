import logger from "../../logger.js";
import { ObservabilityTestDetails } from "./types.js";
import config from "../../config.js";

// Authentication
const auth = Buffer.from(
  `${config.browserstackUsername}:${config.browserstackAccessKey}`,
).toString("base64");

export async function retrieveObservabilityTestCase(
  testId: string,
): Promise<string> {
  logger.info(`Retrieving test case for test ID: ${testId}`);

  try {
    const url = `https://api-observability.browserstack.com/ext/v1/testRun/${testId}/details`;

    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to retrieve test case: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const ollyTestDetails = (await response.json()) as ObservabilityTestDetails;

    if (!ollyTestDetails.testCode || !ollyTestDetails.testCode.code) {
      return "No test code found in the response";
    }

    return ollyTestDetails.testCode.code;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to retrieve test case: ${errorMessage}`);
    throw new Error(`Failed to retrieve test case: ${errorMessage}`);
  }
}
